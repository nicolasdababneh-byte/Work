const SPORTS = ["Football", "Basketball", "Baseball", "Hockey", "Soccer", "Tennis", "MMA", "Golf", "Boxing", "Esports"];
const STORE_KEY = "edgeledger.bets.v1";
const SETTINGS_KEY = "edgeledger.settings.v1";

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `bet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const sampleBets = [
  {
    id: uid(),
    date: "2026-05-24",
    sport: "Basketball",
    league: "NBA",
    market: "Player Prop",
    event: "Pacers at Knicks",
    pick: "Jalen Brunson over 29.5 points",
    odds: -115,
    stake: 50,
    status: "Won",
    book: "FanDuel",
    player: "Jalen Brunson",
    propLine: "29.5 points",
    parlay: false,
    legs: 1,
    notes: "Usage edge with short rotation."
  },
  {
    id: uid(),
    date: "2026-05-26",
    sport: "Hockey",
    league: "NHL",
    market: "Moneyline",
    event: "Stars at Oilers",
    pick: "Oilers ML",
    odds: -125,
    stake: 80,
    status: "Lost",
    book: "DraftKings",
    player: "",
    propLine: "",
    parlay: false,
    legs: 1,
    notes: ""
  },
  {
    id: uid(),
    date: "2026-05-28",
    sport: "Soccer",
    league: "UCL",
    market: "Parlay",
    event: "Final props",
    pick: "BTTS + over 2.5",
    odds: 185,
    stake: 35,
    status: "Won",
    book: "Bet365",
    player: "",
    propLine: "",
    parlay: true,
    legs: 2,
    notes: "Correlation accepted."
  },
  {
    id: uid(),
    date: "2026-06-03",
    sport: "Football",
    league: "NFL",
    market: "Future",
    event: "Season wins",
    pick: "Lions over 10.5 wins",
    odds: 110,
    stake: 60,
    status: "Pending",
    book: "Caesars",
    player: "",
    propLine: "",
    parlay: false,
    legs: 1,
    notes: "Schedule and roster continuity."
  }
];

let bets = loadBets();
let settings = loadSettings();
let filters = { sport: "all", status: "all", market: "all", search: "" };
let calendarDate = new Date();

const el = (id) => document.getElementById(id);
const currency = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const pct = (n) => `${Number.isFinite(n) ? n.toFixed(1) : "0.0"}%`;

function loadBets() {
  const stored = localStorage.getItem(STORE_KEY);
  if (stored) return JSON.parse(stored);
  localStorage.setItem(STORE_KEY, JSON.stringify(sampleBets));
  return sampleBets;
}

function loadSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"defaultStake":50,"maxLegs":4,"bankroll":1000}');
}

function saveBets() {
  localStorage.setItem(STORE_KEY, JSON.stringify(bets));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function profitForBet(bet) {
  if (bet.status === "Pending") return 0;
  if (bet.status === "Push") return 0;
  if (bet.status === "Lost") return -Number(bet.stake);
  const odds = Number(bet.odds);
  const stake = Number(bet.stake);
  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}

function potentialProfit(odds, stake) {
  odds = Number(odds);
  stake = Number(stake);
  if (!odds || !stake) return 0;
  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
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

function init() {
  populateSports();
  bindEvents();
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
  ["oddsInput", "stakeInput", "statusInput"].forEach((id) => el(id).addEventListener("input", updateSettlementPreview));
  el("prevMonthBtn").addEventListener("click", () => changeMonth(-1));
  el("nextMonthBtn").addEventListener("click", () => changeMonth(1));
  el("exportBtn").addEventListener("click", exportCsv);
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
  el("formTitle").textContent = "Add bet";
  updateSettlementPreview();
}

function saveBetFromForm(event) {
  event.preventDefault();
  const bet = {
    id: el("betId").value || uid(),
    date: el("dateInput").value,
    sport: el("sportInput").value,
    league: el("leagueInput").value.trim(),
    market: el("marketInput").value,
    event: el("eventInput").value.trim(),
    pick: el("pickInput").value.trim(),
    odds: Number(el("oddsInput").value),
    stake: Number(el("stakeInput").value),
    status: el("statusInput").value,
    book: el("bookInput").value.trim(),
    player: el("playerInput").value.trim(),
    propLine: el("propLineInput").value.trim(),
    parlay: el("parlayInput").checked || el("marketInput").value === "Parlay",
    legs: Number(el("legsInput").value) || 1,
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
  const odds = Number(el("oddsInput").value);
  const stake = Number(el("stakeInput").value);
  const status = el("statusInput").value;
  const win = potentialProfit(odds, stake);
  const value = status === "Won" ? win : status === "Lost" ? -stake : 0;
  el("settlementPreview").textContent = `Potential win: ${currency(win)}. Current settlement: ${currency(value)}.`;
}

function render() {
  renderQuickSports();
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
  el("betsTable").innerHTML = visible.map((bet) => `
    <tr>
      <td>${bet.date}</td>
      <td><strong>${bet.sport}</strong><br><small>${bet.league || bet.book || ""}</small></td>
      <td><strong>${bet.pick}</strong><br><small>${bet.event} - ${bet.market}${bet.parlay ? ` - ${bet.legs} legs` : ""}</small></td>
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
  renderRiskPanel();
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
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function exportCsv() {
  const headers = ["date", "sport", "league", "market", "event", "pick", "odds", "stake", "status", "profit", "book", "player", "propLine", "parlay", "legs", "notes"];
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

window.addEventListener("resize", render);
init();
