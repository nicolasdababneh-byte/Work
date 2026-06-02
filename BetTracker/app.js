const SPORTS = ["Football", "Basketball", "Baseball", "Hockey", "Soccer", "Tennis", "MMA", "Golf", "Boxing", "Esports", "Multi-sport"];
const STORE_KEY = "edgeledger.bets.v1";
const SETTINGS_KEY = "edgeledger.settings.v1";

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `bet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DEMO_PICKS = new Set([
  "Jalen Brunson over 29.5 points",
  "Oilers ML",
  "BTTS + over 2.5",
  "Lions over 10.5 wins"
]);

let bets = loadBets();
let settings = loadSettings();
let filters = { sport: "all", status: "all", market: "all", search: "" };
let calendarDate = new Date();
let parlayLegs = [];
let supabaseClient = null;
let currentUser = null;
let cloudSaveTimer = null;
let cloudConfigured = false;

const el = (id) => document.getElementById(id);
const currency = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const pct = (n) => `${Number.isFinite(n) ? n.toFixed(1) : "0.0"}%`;

function loadBets() {
  const stored = localStorage.getItem(STORE_KEY);
  if (!stored) return [];

  const parsed = JSON.parse(stored);
  const containsOnlyDemoBets = parsed.length > 0 && parsed.every((bet) => DEMO_PICKS.has(bet.pick));
  if (containsOnlyDemoBets) {
    localStorage.setItem(STORE_KEY, JSON.stringify([]));
    return [];
  }

  const normalized = parsed.map((bet) => normalizeBet(bet));
  if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function loadSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"defaultStake":50,"maxLegs":4,"bankroll":1000}');
}

function saveBets() {
  localStorage.setItem(STORE_KEY, JSON.stringify(bets));
  queueCloudSave();
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  queueCloudSave();
}

function profitForBet(bet) {
  if (bet.status === "Pending") return 0;
  if (bet.status === "Push") return 0;
  if (bet.status === "Lost") return -Number(bet.stake);
  const odds = Number(bet.odds);
  const stake = Number(bet.stake);
  return stake * Math.max(0, odds - 1);
}

function potentialProfit(odds, stake) {
  odds = Number(odds);
  stake = Number(stake);
  if (!odds || !stake) return 0;
  return stake * Math.max(0, odds - 1);
}

function normalizeStoredOdds(odds) {
  const value = Number(odds);
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return Number((1 + 100 / Math.abs(value)).toFixed(2));
  if (value >= 100) return Number((1 + value / 100).toFixed(2));
  return value;
}

function normalizeBet(bet) {
  const normalizedLegs = Array.isArray(bet.parlayLegs)
    ? bet.parlayLegs.map((leg) => normalizeParlayLeg(leg))
    : parseLegDetails(bet.legDetails || "");

  return {
    ...bet,
    odds: normalizeStoredOdds(bet.odds),
    legDetails: bet.legDetails || formatLegDetails(normalizedLegs),
    parlayLegs: normalizedLegs
  };
}

function normalizeParlayLeg(leg = {}) {
  return {
    id: leg.id || uid(),
    sport: leg.sport || "Football",
    market: leg.market || "Moneyline",
    pick: leg.pick || "",
    odds: normalizeStoredOdds(leg.odds || 1)
  };
}

function parseLegDetails(details) {
  return details.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const oddsMatch = line.match(/@?\s*(\d+(?:\.\d+)?)\s*$/);
    const odds = oddsMatch ? Number(oddsMatch[1]) : 1;
    const pick = oddsMatch ? line.slice(0, oddsMatch.index).replace(/^Leg\s+\d+:\s*/i, "").trim() : line.replace(/^Leg\s+\d+:\s*/i, "").trim();
    return normalizeParlayLeg({ id: uid(), sport: "Multi-sport", market: "Parlay", pick: pick || `Leg ${index + 1}`, odds });
  });
}

function filteredBets() {
  const search = filters.search.toLowerCase();
  return bets.filter((bet) => {
    const matchesSport = filters.sport === "all" || bet.sport === filters.sport;
    const matchesStatus = filters.status === "all" || bet.status === filters.status;
    const matchesMarket = filters.market === "all" || bet.market === filters.market;
    const haystack = `${bet.event} ${bet.pick} ${bet.player} ${bet.league}`.toLowerCase();
    return matchesSport && matchesStatus && matchesMarket && haystack.includes(search);
  });
}

async function init() {
  populateSports();
  bindEvents();
  setupCloud();
  await restoreSession();
  resetForm();
  render();
}

function populateSports() {
  [el("sportFilter"), el("sportInput")].forEach((select) => {
    SPORTS.forEach((sport) => {
      const option = document.createElement("option");
      option.value = sport;
      option.textContent = sport;
      select.appendChild(option);
    });
  });

  el("sportQuickFilters").innerHTML = SPORTS.slice(0, 7).map((sport) => `<button class="sport-chip" data-sport="${sport}">${sport}</button>`).join("");
}

function bindEvents() {
  document.querySelectorAll(".nav a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setView(link.dataset.section);
    });
  });

  el("sportFilter").addEventListener("change", (event) => {
    filters.sport = event.target.value;
    render();
  });
  el("statusFilter").addEventListener("change", (event) => {
    filters.status = event.target.value;
    render();
  });
  el("marketFilter").addEventListener("change", (event) => {
    filters.market = event.target.value;
    render();
  });
  el("searchFilter").addEventListener("input", (event) => {
    filters.search = event.target.value;
    render();
  });

  el("sportQuickFilters").addEventListener("click", (event) => {
    if (!event.target.matches(".sport-chip")) return;
    filters.sport = filters.sport === event.target.dataset.sport ? "all" : event.target.dataset.sport;
    el("sportFilter").value = filters.sport;
    render();
  });

  el("newBetBtn").addEventListener("click", () => {
    setView("tracker");
    el("eventInput").focus();
  });
  el("resetFormBtn").addEventListener("click", resetForm);
  el("betForm").addEventListener("submit", saveBetFromForm);
  ["oddsInput", "stakeInput", "statusInput", "marketInput"].forEach((id) => el(id).addEventListener("input", () => {
    syncParlayMode();
    updateSettlementPreview();
  }));
  el("parlayInput").addEventListener("change", () => {
    syncParlayMode();
    updateSettlementPreview();
  });
  el("legsInput").addEventListener("input", syncLegCountFromInput);
  el("addLegBtn").addEventListener("click", () => addParlayLeg());
  el("parlayLegsList").addEventListener("input", updateParlayLegFromInput);
  el("parlayLegsList").addEventListener("change", updateParlayLegFromInput);
  el("parlayLegsList").addEventListener("click", handleParlayLegClick);
  el("prevMonthBtn").addEventListener("click", () => changeMonth(-1));
  el("nextMonthBtn").addEventListener("click", () => changeMonth(1));
  el("exportBtn").addEventListener("click", exportCsv);
  el("backupBtn").addEventListener("click", exportBackup);
  el("importBtn").addEventListener("click", () => el("importFileInput").click());
  el("importFileInput").addEventListener("change", importBackup);
  el("signInBtn").addEventListener("click", signIn);
  el("signUpBtn").addEventListener("click", signUp);
  el("signOutBtn").addEventListener("click", signOut);
  el("emptyAddBtn").addEventListener("click", () => {
    setView("tracker");
    el("eventInput").focus();
  });
  el("saveSettingsBtn").addEventListener("click", () => {
    settings = {
      defaultStake: Number(el("defaultStakeInput").value) || 0,
      maxLegs: Number(el("maxLegsInput").value) || 1,
      bankroll: Number(el("bankrollInput").value) || 0
    };
    saveSettings();
    renderRiskPanel();
  });
}

function setupCloud() {
  const config = window.EDGELEDGER_SUPABASE || {};
  cloudConfigured = Boolean(config.url && config.anonKey && window.supabase);
  if (!cloudConfigured) {
    updateAuthUi("Local mode", "Add Supabase keys to enable sync");
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) await loadCloudProfile();
    updateAuthUi();
    render();
  });
}

async function restoreSession() {
  if (!supabaseClient) {
    updateAuthUi();
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    updateAuthUi("Sync unavailable", error.message);
    return;
  }

  currentUser = data.session?.user || null;
  if (currentUser) await loadCloudProfile();
  updateAuthUi();
}

async function signUp() {
  if (!ensureCloudConfigured()) return;
  const credentials = getAuthCredentials();
  if (!credentials) return;

  updateAuthUi("Creating account", "Saving your tracker in the cloud");
  const { error } = await supabaseClient.auth.signUp(credentials);
  if (error) {
    updateAuthUi("Sign up failed", error.message);
    return;
  }

  updateAuthUi("Check your email", "Confirm your account, then sign in");
}

async function signIn() {
  if (!ensureCloudConfigured()) return;
  const credentials = getAuthCredentials();
  if (!credentials) return;

  updateAuthUi("Signing in", "Loading your synced tracker");
  const { error } = await supabaseClient.auth.signInWithPassword(credentials);
  if (error) {
    updateAuthUi("Sign in failed", error.message);
    return;
  }
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  updateAuthUi();
}

function getAuthCredentials() {
  const email = el("authEmailInput").value.trim();
  const password = el("authPasswordInput").value;
  if (!email || !password) {
    updateAuthUi("Missing sign in", "Enter your email and password");
    return null;
  }
  return { email, password };
}

function ensureCloudConfigured() {
  if (cloudConfigured) return true;
  updateAuthUi("Cloud not configured", "Add your Supabase URL and anon key");
  return false;
}

async function loadCloudProfile() {
  if (!supabaseClient || !currentUser) return;
  updateAuthUi("Syncing", "Loading cloud data");

  const { data, error } = await supabaseClient
    .from("bet_tracker_profiles")
    .select("bets, settings")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    updateAuthUi("Sync error", error.message);
    return;
  }

  if (data) {
    bets = Array.isArray(data.bets) ? data.bets.map((bet) => normalizeBet(bet)) : [];
    settings = { ...settings, ...(data.settings || {}) };
    localStorage.setItem(STORE_KEY, JSON.stringify(bets));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    updateAuthUi();
    return;
  }

  await saveCloudProfile();
  updateAuthUi("Synced", "Local tracker copied to your account");
}

function queueCloudSave() {
  if (!supabaseClient || !currentUser) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(saveCloudProfile, 500);
}

async function saveCloudProfile() {
  if (!supabaseClient || !currentUser) return;
  updateAuthUi("Syncing", "Saving changes");

  const { error } = await supabaseClient
    .from("bet_tracker_profiles")
    .upsert({
      user_id: currentUser.id,
      bets,
      settings
    }, { onConflict: "user_id" });

  if (error) {
    updateAuthUi("Sync error", error.message);
    return;
  }

  updateAuthUi("Synced", "Saved across your devices");
}

function updateAuthUi(status, detail) {
  const isSignedIn = Boolean(currentUser);
  el("authPanel").classList.toggle("signed-in", isSignedIn);
  el("authStatus").textContent = status || (isSignedIn ? currentUser.email : cloudConfigured ? "Signed out" : "Local mode");
  el("syncStatus").textContent = detail || (isSignedIn ? "Cloud sync is on" : cloudConfigured ? "Sign in to sync across devices" : "Add Supabase keys to enable sync");
}

function setView(section) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === section));
  document.querySelectorAll(".nav a").forEach((link) => link.classList.toggle("active", link.dataset.section === section));
}

function resetForm() {
  el("betForm").reset();
  el("betId").value = "";
  el("dateInput").valueAsDate = new Date();
  el("sportInput").value = "Football";
  el("stakeInput").value = settings.defaultStake;
  el("legsInput").value = 1;
  parlayLegs = [];
  renderParlayLegs();
  syncParlayMode();
  el("formTitle").textContent = "Add bet";
  updateSettlementPreview();
}

function saveBetFromForm(event) {
  event.preventDefault();
  const isParlay = el("parlayInput").checked || el("marketInput").value === "Parlay";
  const savedLegs = isParlay ? parlayLegs.map((leg) => normalizeParlayLeg(leg)).filter(isCompleteParlayLeg) : [];
  if (isParlay && savedLegs.length < 2) {
    alert("Add at least two completed parlay legs with a pick and decimal odds.");
    return;
  }
  const odds = isParlay && savedLegs.length ? calculateParlayOdds(savedLegs) : Number(el("oddsInput").value);
  const bet = {
    id: el("betId").value || uid(),
    date: el("dateInput").value,
    sport: el("sportInput").value,
    league: el("leagueInput").value.trim(),
    market: el("marketInput").value,
    event: el("eventInput").value.trim(),
    pick: el("pickInput").value.trim(),
    odds,
    stake: Number(el("stakeInput").value),
    status: el("statusInput").value,
    book: el("bookInput").value.trim(),
    player: el("playerInput").value.trim(),
    propLine: el("propLineInput").value.trim(),
    parlay: isParlay,
    legs: isParlay ? Math.max(1, savedLegs.length) : 1,
    legDetails: formatLegDetails(savedLegs),
    parlayLegs: savedLegs,
    notes: el("notesInput").value.trim()
  };

  const existingIndex = bets.findIndex((item) => item.id === bet.id);
  if (existingIndex >= 0) bets[existingIndex] = bet;
  else bets.unshift(bet);

  saveBets();
  resetForm();
  render();
}

function updateSettlementPreview() {
  const isParlay = el("parlayInput").checked || el("marketInput").value === "Parlay";
  const odds = isParlay && parlayLegs.length ? calculateParlayOdds(parlayLegs) : Number(el("oddsInput").value);
  const stake = Number(el("stakeInput").value);
  const status = el("statusInput").value;
  const win = potentialProfit(odds, stake);
  const value = status === "Won" ? win : status === "Lost" ? -stake : 0;
  if (isParlay) {
    renderParlaySummary();
    el("oddsInput").value = odds ? formatOdds(odds) : "";
  }
  el("settlementPreview").textContent = `Decimal odds ${formatOdds(odds)} return ${currency(stake + win)} total on a win. Profit: ${currency(value)}.`;
}

function syncParlayMode() {
  const isParlay = el("parlayInput").checked || el("marketInput").value === "Parlay";
  el("parlayInput").checked = isParlay;
  if (isParlay) {
    el("marketInput").value = "Parlay";
    el("sportInput").value = "Multi-sport";
    if (!parlayLegs.length) {
      parlayLegs = [createParlayLeg(), createParlayLeg()];
    }
  }
  el("oddsInput").readOnly = isParlay;
  el("parlayBuilder").classList.toggle("active", isParlay);
  renderParlayLegs();
}

function createParlayLeg(overrides = {}) {
  return normalizeParlayLeg({ id: uid(), sport: "Football", market: "Moneyline", pick: "", odds: 1.91, ...overrides });
}

function addParlayLeg(overrides = {}) {
  parlayLegs.push(createParlayLeg(overrides));
  renderParlayLegs();
  updateSettlementPreview();
}

function syncLegCountFromInput() {
  const desired = Math.max(1, Number(el("legsInput").value) || 1);
  while (parlayLegs.length < desired) parlayLegs.push(createParlayLeg());
  while (parlayLegs.length > desired) parlayLegs.pop();
  renderParlayLegs();
  updateSettlementPreview();
}

function updateParlayLegFromInput(event) {
  const field = event.target.dataset.field;
  const id = event.target.dataset.id;
  if (!field || !id) return;
  const leg = parlayLegs.find((item) => item.id === id);
  if (!leg) return;
  leg[field] = field === "odds" ? Number(event.target.value) : event.target.value;
  renderParlaySummary();
  updateSettlementPreview();
}

function handleParlayLegClick(event) {
  const action = event.target.dataset.action;
  const id = event.target.dataset.id;
  if (action !== "remove-leg" || !id) return;
  parlayLegs = parlayLegs.filter((leg) => leg.id !== id);
  if (!parlayLegs.length) parlayLegs.push(createParlayLeg());
  renderParlayLegs();
  updateSettlementPreview();
}

function renderParlayLegs() {
  const list = el("parlayLegsList");
  if (!list) return;
  list.innerHTML = parlayLegs.map((leg, index) => `
    <article class="parlay-leg">
      <div class="parlay-leg-top">
        <strong>Leg ${index + 1}</strong>
        <div class="parlay-leg-actions">
          <span class="leg-odds-preview">@ ${formatOdds(leg.odds)}</span>
          <button class="mini-button danger-button" type="button" data-action="remove-leg" data-id="${leg.id}">Remove</button>
        </div>
      </div>
      <div class="parlay-leg-grid">
        <label>
          Sport
          <select data-field="sport" data-id="${leg.id}">${SPORTS.map((sport) => `<option value="${sport}" ${sport === leg.sport ? "selected" : ""}>${sport}</option>`).join("")}</select>
        </label>
        <label>
          Market
          <select data-field="market" data-id="${leg.id}">
            ${["Spread", "Moneyline", "Total", "Player Prop", "Game Prop", "Future"].map((market) => `<option value="${market}" ${market === leg.market ? "selected" : ""}>${market}</option>`).join("")}
          </select>
        </label>
        <label>
          Pick
          <input data-field="pick" data-id="${leg.id}" value="${escapeHtml(leg.pick)}" placeholder="Team, total, or prop">
        </label>
        <label>
          Decimal odds
          <input data-field="odds" data-id="${leg.id}" type="number" min="1.01" step="0.01" value="${formatOdds(leg.odds)}">
        </label>
      </div>
    </article>
  `).join("");
  renderParlaySummary();
}

function renderParlaySummary() {
  const combinedOdds = calculateParlayOdds(parlayLegs);
  const stake = Number(el("stakeInput").value);
  const totalReturn = stake * combinedOdds;
  el("legsInput").value = parlayLegs.length || 1;
  el("legDetailsInput").value = formatLegDetails(parlayLegs);
  el("parlayCombinedOdds").textContent = `Combined odds ${formatOdds(combinedOdds)}`;
  el("parlayLegCount").textContent = `${parlayLegs.length} ${parlayLegs.length === 1 ? "leg" : "legs"}`;
  el("parlayReturnPreview").textContent = `${currency(totalReturn)} total return`;
}

function calculateParlayOdds(legs) {
  const validLegs = legs.filter((leg) => Number(leg.odds) > 1);
  if (!validLegs.length) return 0;
  return Number(validLegs.reduce((product, leg) => product * Number(leg.odds), 1).toFixed(2));
}

function isCompleteParlayLeg(leg) {
  return Boolean(leg.pick.trim()) && Number(leg.odds) > 1;
}

function formatLegDetails(legs) {
  return legs.map((leg, index) => `Leg ${index + 1}: ${leg.sport} - ${leg.market} - ${leg.pick || "Untitled pick"} @ ${formatOdds(leg.odds)}`).join("\n");
}

function render() {
  renderQuickSports();
  renderEmptyState();
  renderDashboard();
  renderTable();
  renderCalendar();
  renderInsights();
}

function renderQuickSports() {
  document.querySelectorAll(".sport-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.sport === filters.sport);
  });
}

function renderEmptyState() {
  el("emptyState").classList.toggle("active", bets.length === 0);
}

function renderDashboard() {
  const visible = filteredBets();
  const settled = visible.filter((bet) => bet.status !== "Pending");
  const wins = visible.filter((bet) => bet.status === "Won").length;
  const losses = visible.filter((bet) => bet.status === "Lost").length;
  const pushes = visible.filter((bet) => bet.status === "Push").length;
  const totalStake = visible.reduce((sum, bet) => sum + Number(bet.stake), 0);
  const settledStake = settled.reduce((sum, bet) => sum + Number(bet.stake), 0);
  const profit = visible.reduce((sum, bet) => sum + profitForBet(bet), 0);
  const pending = visible.filter((bet) => bet.status === "Pending");

  el("totalProfit").textContent = currency(profit);
  el("totalProfit").className = profit >= 0 ? "positive" : "negative";
  el("roiLabel").textContent = `ROI ${pct((profit / settledStake) * 100)}`;
  el("winRate").textContent = pct((wins / Math.max(1, wins + losses)) * 100);
  el("recordLabel").textContent = `${wins}-${losses}-${pushes}`;
  el("totalStake").textContent = currency(totalStake);
  el("betsCount").textContent = `${visible.length} bets tracked`;
  el("pendingStake").textContent = currency(pending.reduce((sum, bet) => sum + Number(bet.stake), 0));
  el("pendingCount").textContent = `${pending.length} pending`;

  drawProfitChart(visible);
  renderSportBreakdown(visible);
  renderRecentBets(visible);
}

function renderSportBreakdown(list) {
  const bySport = groupProfit(list, "sport");
  const max = Math.max(1, ...bySport.map((row) => Math.abs(row.profit)));
  el("sportBreakdown").innerHTML = bySport.slice(0, 6).map((row) => `
    <div class="breakdown-row">
      <div class="breakdown-top">
        <strong>${row.key}</strong>
        <span class="${row.profit >= 0 ? "positive" : "negative"}">${currency(row.profit)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, Math.abs(row.profit) / max * 100)}%"></div></div>
    </div>
  `).join("") || "<p>No bets match these filters.</p>";
}

function renderRecentBets(list) {
  const recent = list.filter((bet) => bet.status !== "Pending").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  el("recentBets").innerHTML = recent.map((bet) => `
    <article class="recent-card">
      <div class="recent-top">
        <strong>${bet.pick}</strong>
        <span class="${profitForBet(bet) >= 0 ? "positive" : "negative"}">${currency(profitForBet(bet))}</span>
      </div>
      <small>${bet.date} - ${bet.sport} - ${bet.market} - ${bet.status}</small>
    </article>
  `).join("") || "<p>No settled bets yet.</p>";
}

function renderTable() {
  const visible = filteredBets().sort((a, b) => b.date.localeCompare(a.date));
  el("ledgerCount").textContent = `${visible.length} entries`;
  if (!visible.length) {
    el("betsTable").innerHTML = `<tr><td class="empty-row" colspan="8">No bets match this view yet.</td></tr>`;
    return;
  }

  el("betsTable").innerHTML = visible.map((bet) => `
    <tr>
      <td>${bet.date}</td>
      <td><strong>${bet.sport}</strong><br><small>${bet.league || bet.book || ""}</small></td>
      <td><strong>${bet.pick}</strong><br><small>${bet.event} - ${bet.market}${bet.parlay ? ` - ${bet.legs} legs` : ""}${bet.legDetails ? ` - ${summarizeLegDetails(bet.legDetails)}` : ""}</small></td>
      <td>${formatOdds(bet.odds)}</td>
      <td>${currency(bet.stake)}</td>
      <td><span class="status-pill status-${bet.status}">${bet.status}</span></td>
      <td class="${profitForBet(bet) >= 0 ? "positive" : "negative"}">${currency(profitForBet(bet))}</td>
      <td>
        <div class="row-actions">
          <button class="mini-button" data-action="edit" data-id="${bet.id}">Edit</button>
          <button class="mini-button" data-action="delete" data-id="${bet.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  el("betsTable").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.action === "edit") editBet(button.dataset.id);
      if (button.dataset.action === "delete") deleteBet(button.dataset.id);
    });
  });
}

function editBet(id) {
  const bet = bets.find((item) => item.id === id);
  if (!bet) return;
  el("betId").value = bet.id;
  el("dateInput").value = bet.date;
  el("sportInput").value = bet.sport;
  el("leagueInput").value = bet.league;
  el("marketInput").value = bet.market;
  el("eventInput").value = bet.event;
  el("pickInput").value = bet.pick;
  el("oddsInput").value = bet.odds;
  el("stakeInput").value = bet.stake;
  el("statusInput").value = bet.status;
  el("bookInput").value = bet.book;
  el("playerInput").value = bet.player;
  el("propLineInput").value = bet.propLine;
  el("parlayInput").checked = bet.parlay;
  el("legsInput").value = bet.legs;
  el("legDetailsInput").value = bet.legDetails || "";
  parlayLegs = bet.parlay ? (bet.parlayLegs || parseLegDetails(bet.legDetails || "")) : [];
  syncParlayMode();
  el("notesInput").value = bet.notes;
  el("formTitle").textContent = "Edit bet";
  updateSettlementPreview();
  setView("tracker");
}

function deleteBet(id) {
  bets = bets.filter((bet) => bet.id !== id);
  saveBets();
  render();
}

function changeMonth(delta) {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta, 1);
  renderCalendar();
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  el("calendarTitle").textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = date.toISOString().slice(0, 10);
    const dayBets = filteredBets().filter((bet) => bet.date === iso);
    const dayProfit = dayBets.reduce((sum, bet) => sum + profitForBet(bet), 0);
    days.push(`
      <div class="day-cell ${date.getMonth() === month ? "" : "outside"}">
        <div class="day-number">
          <span>${date.getDate()}</span>
          <small class="${dayProfit >= 0 ? "positive" : "negative"}">${dayBets.length ? currency(dayProfit) : ""}</small>
        </div>
        ${dayBets.slice(0, 3).map((bet) => `<div class="day-bet">${bet.status}: ${bet.pick}</div>`).join("")}
      </div>
    `);
  }
  el("calendarGrid").innerHTML = days.join("");
}

function renderInsights() {
  el("defaultStakeInput").value = settings.defaultStake;
  el("maxLegsInput").value = settings.maxLegs;
  el("bankrollInput").value = settings.bankroll;
  drawSportsChart(filteredBets());
  drawResultChart(filteredBets());
  renderPerformancePulse();
  renderRiskPanel();
}

function renderPerformancePulse() {
  const visible = filteredBets();
  const settled = visible.filter((bet) => bet.status !== "Pending");
  const markets = groupProfit(settled, "market");
  const books = groupProfit(settled, "book").filter((row) => row.key !== "Other");
  const biggestWin = settled.reduce((best, bet) => !best || profitForBet(bet) > profitForBet(best) ? bet : best, null);
  const biggestLoss = settled.reduce((worst, bet) => !worst || profitForBet(bet) < profitForBet(worst) ? bet : worst, null);
  const avgStake = visible.length ? visible.reduce((sum, bet) => sum + Number(bet.stake), 0) / visible.length : 0;
  const avgOdds = visible.length ? visible.reduce((sum, bet) => sum + Number(bet.odds), 0) / visible.length : 0;

  const cards = [
    ["Best market", markets[0] ? `${markets[0].key} (${currency(markets[0].profit)})` : "No settled bets"],
    ["Best book", books[0] ? `${books[0].key} (${currency(books[0].profit)})` : "No book data"],
    ["Biggest win", biggestWin ? `${biggestWin.pick} (${currency(profitForBet(biggestWin))})` : "None yet"],
    ["Biggest loss", biggestLoss ? `${biggestLoss.pick} (${currency(profitForBet(biggestLoss))})` : "None yet"],
    ["Average stake", currency(avgStake)],
    ["Average odds", visible.length ? formatOdds(avgOdds) : "No bets"]
  ];

  el("performancePulse").innerHTML = cards.map(([label, value]) => `
    <div class="pulse-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderRiskPanel() {
  const pendingParlays = bets.filter((bet) => bet.status === "Pending" && bet.parlay);
  const exposure = pendingParlays.reduce((sum, bet) => sum + Number(bet.stake), 0);
  const bankrollPct = settings.bankroll ? (exposure / settings.bankroll) * 100 : 0;
  const aboveMax = pendingParlays.filter((bet) => bet.legs > settings.maxLegs).length;
  el("riskPanel").innerHTML = `
    <strong>${currency(exposure)}</strong> pending parlay exposure<br>
    <span>${pct(bankrollPct)} of monthly bankroll. ${aboveMax} pending parlays exceed your leg limit.</span>
  `;
}

function drawProfitChart(list) {
  const canvas = el("profitChart");
  const ctx = setupCanvas(canvas);
  const settled = list.filter((bet) => bet.status !== "Pending").sort((a, b) => a.date.localeCompare(b.date));
  const points = [];
  let running = 0;
  settled.forEach((bet) => {
    running += profitForBet(bet);
    points.push({ date: bet.date, value: running });
  });
  drawLine(ctx, canvas, points, "#1c64f2");
}

function drawSportsChart(list) {
  const canvas = el("sportsChart");
  const ctx = setupCanvas(canvas);
  const rows = groupProfit(list, "sport").slice(0, 8);
  drawBars(ctx, canvas, rows);
}

function drawResultChart(list) {
  const canvas = el("resultChart");
  const ctx = setupCanvas(canvas);
  const settled = list.filter((bet) => bet.status !== "Pending");
  const counts = ["Won", "Lost", "Push"].map((status) => ({ key: status, value: settled.filter((bet) => bet.status === status).length }));
  drawDonut(ctx, canvas, counts);
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const baseHeight = Number(canvas.dataset.baseHeight || canvas.getAttribute("height") || 260);
  canvas.dataset.baseHeight = String(baseHeight);
  canvas.width = rect.width * ratio;
  canvas.height = baseHeight * ratio;
  canvas.style.height = `${baseHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, baseHeight);
  return ctx;
}

function drawLine(ctx, canvas, points, color) {
  const width = canvas.getBoundingClientRect().width;
  const height = Number(canvas.dataset.baseHeight);
  ctx.strokeStyle = "#dbe3ef";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = 24 + i * ((height - 48) / 4);
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 18, y);
    ctx.stroke();
  }
  if (!points.length) {
    ctx.fillStyle = "#697386";
    ctx.fillText("No settled bets to chart yet", 36, height / 2);
    return;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const xStep = (width - 60) / Math.max(1, points.length - 1);
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = 36 + index * xStep;
    const y = height - 26 - ((point.value - min) / (max - min || 1)) * (height - 52);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  points.forEach((point, index) => {
    const x = 36 + index * xStep;
    const y = height - 26 - ((point.value - min) / (max - min || 1)) * (height - 52);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawBars(ctx, canvas, rows) {
  const width = canvas.getBoundingClientRect().width;
  const height = Number(canvas.dataset.baseHeight);
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.profit)));
  if (!rows.length) {
    ctx.fillStyle = "#697386";
    ctx.fillText("No data yet", 26, height / 2);
    return;
  }
  rows.forEach((row, index) => {
    const y = 28 + index * 32;
    const barWidth = Math.max(8, Math.abs(row.profit) / max * (width - 150));
    ctx.fillStyle = "#172033";
    ctx.fillText(row.key, 24, y + 14);
    ctx.fillStyle = row.profit >= 0 ? "#11845b" : "#c2413a";
    ctx.fillRect(120, y, barWidth, 18);
    ctx.fillText(currency(row.profit), 130 + barWidth, y + 14);
  });
}

function drawDonut(ctx, canvas, counts) {
  const width = canvas.getBoundingClientRect().width;
  const height = Number(canvas.dataset.baseHeight);
  const total = counts.reduce((sum, row) => sum + row.value, 0);
  const colors = ["#11845b", "#c2413a", "#b7791f"];
  if (!total) {
    ctx.fillStyle = "#697386";
    ctx.fillText("No settled results yet", 30, height / 2);
    return;
  }
  let start = -Math.PI / 2;
  counts.forEach((row, index) => {
    const angle = (row.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 88, start, start + angle);
    ctx.lineWidth = 32;
    ctx.strokeStyle = colors[index];
    ctx.stroke();
    start += angle;
  });
  ctx.fillStyle = "#172033";
  ctx.font = "700 24px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(`${total}`, width / 2, height / 2);
  ctx.font = "13px system-ui";
  ctx.fillStyle = "#697386";
  ctx.fillText("settled", width / 2, height / 2 + 22);
  ctx.textAlign = "left";
  counts.forEach((row, index) => {
    ctx.fillStyle = colors[index];
    ctx.fillRect(24, 24 + index * 26, 12, 12);
    ctx.fillStyle = "#172033";
    ctx.fillText(`${row.key}: ${row.value}`, 44, 35 + index * 26);
  });
}

function groupProfit(list, key) {
  const map = new Map();
  list.forEach((bet) => {
    const name = bet[key] || "Other";
    map.set(name, (map.get(name) || 0) + profitForBet(bet));
  });
  return [...map.entries()].map(([name, profit]) => ({ key: name, profit })).sort((a, b) => b.profit - a.profit);
}

function formatOdds(odds) {
  const value = Number(odds);
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "0.00";
}

function summarizeLegDetails(details) {
  const lines = details.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "leg details saved";
  return lines.length === 1 ? lines[0] : `${lines.length} detailed legs`;
}

function exportCsv() {
  const headers = ["date", "sport", "league", "market", "event", "pick", "odds", "stake", "status", "profit", "book", "player", "propLine", "parlay", "legs", "legDetails", "notes"];
  const lines = [headers.join(",")].concat(bets.map((bet) => headers.map((key) => {
    const value = key === "profit" ? profitForBet(bet) : bet[key];
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "edgeledger-bets.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const payload = {
    app: "EdgeLedger",
    version: 1,
    exportedAt: new Date().toISOString(),
    bets,
    settings
  };
  downloadFile("edgeledger-backup.json", JSON.stringify(payload, null, 2), "application/json");
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const importedBets = Array.isArray(payload) ? payload : payload.bets;
      if (!Array.isArray(importedBets)) throw new Error("Backup does not contain bets.");

      bets = importedBets.map((bet) => normalizeBet({ ...bet, id: bet.id || uid() }));
      if (payload.settings) settings = { ...settings, ...payload.settings };
      saveBets();
      saveSettings();
      render();
      event.target.value = "";
    } catch (error) {
      alert(`Could not import backup: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

window.addEventListener("resize", render);
init();
