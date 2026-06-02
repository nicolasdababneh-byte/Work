# EdgeLedger Cloud Sync Setup

Use Supabase to make bets save across your laptop, phone, and any other device.

1. Create a project at `https://supabase.com`.
2. Open **SQL Editor** and run the contents of `supabase-schema.sql`.
3. Open **Authentication > Providers > Email** and make sure email/password sign-in is enabled.
4. Open **Project Settings > API**.
5. Copy your **Project URL** and **anon public key**.
6. Paste them into `BetTracker/supabase-config.js`:

```js
window.EDGELEDGER_SUPABASE = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-public-key"
};
```

7. Commit and push that config update.

The anon key is safe to use in a browser app. The database privacy is enforced by Supabase row-level security, so each signed-in user only reads and writes their own tracker row.
