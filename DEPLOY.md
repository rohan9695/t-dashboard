# Trading Monitor — Deployment Guide

Migration from `C:\account-dashboard\main.py` (FastAPI + ngrok)
to Vercel + Supabase + iPhone PWA.

---

## What changed vs main.py

| main.py                        | This project                          |
|--------------------------------|---------------------------------------|
| FastAPI in-memory `accounts` dict | Supabase `accounts` table          |
| `account_state.json` file      | Supabase persists it automatically    |
| HTTP Basic auth on dashboard   | Supabase Auth (anon key)              |
| 5-second JS polling            | Supabase Realtime WebSocket           |
| ngrok tunnel                   | Vercel HTTPS (permanent URL)          |
| Python `ITEM_MAP`              | TypeScript `ITEM_MAP` (same keys)     |
| `compute_tradovate_metrics()`  | `computeTradovateMetrics()` (same logic) |
| `ACCOUNT_SIZE_PROFILES`        | Same values, same detection logic     |
| POST `/update`                 | POST `/api/update` (same payload)     |
| GET  `/data`                   | GET  `/api/data`  (same response shape) |
| GET  `/debug/items`            | GET  `/api/debug/items`               |

**Your NT8 addon only needs one change: the URL it posts to.**

---

## Step 1 — Supabase setup (5 min)

1. Go to https://supabase.com → New project
2. Choose a region close to you (US East if you're US-based)
3. Save your database password somewhere safe
4. Dashboard → SQL Editor → New query
5. Paste the entire contents of `supabase/schema.sql` → Run

Done. Your tables, RLS, and Realtime are configured.

Get your keys:
- Dashboard → Settings → API
- Copy: **Project URL**, **anon public key**, **service_role key**

---

## Step 2 — Deploy to Vercel (5 min)

Option A — GitHub (recommended):
```bash
# On your machine
git init
git add .
git commit -m "initial"
# Push to a new GitHub repo, then import in Vercel dashboard
```

Option B — Vercel CLI:
```bash
npm i -g vercel
vercel
# Follow the prompts
```

After deploying, go to Vercel → your project → Settings → Environment Variables.
Add these (one by one):

```
NEXT_PUBLIC_SUPABASE_URL        = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = eyJ...
SUPABASE_SERVICE_ROLE_KEY       = eyJ...
API_KEY                         = (same value as your current API_KEY in .env)
```

Redeploy after adding env vars:
Vercel dashboard → Deployments → Redeploy

Your dashboard will be live at: `https://your-project.vercel.app`

---

## Step 3 — Update your NT8 addon (1 line change)

In your NinjaTrader C# addon, find the line that sets the endpoint URL.
It currently points at something like:
```
http://localhost:8000/update
```
or via ngrok:
```
https://xxxx.ngrok.io/update
```

Change it to:
```
https://your-project.vercel.app/api/update
```

The `X-Api-Key` header and all payload formats are **identical** — no other changes needed.

If your addon uses a config file or NinjaTrader.ini, update the URL there.

---

## Step 4 — iPhone PWA setup

1. Open Safari on your iPhone
2. Navigate to `https://your-project.vercel.app`
3. Tap the **Share button** (box with arrow) at the bottom
4. Tap **Add to Home Screen**
5. Tap **Add**

The app opens full-screen, no Safari chrome, and updates in real time via WebSocket.

---

## Step 5 — Verify everything works

### Test the update endpoint:
```bash
curl -X POST https://your-project.vercel.app/api/update \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_API_KEY" \
  -d '{"account": "Apex-Test-1", "item": "CashValue", "value": 51234.56}'
```
Expected: `{"status":"ok","field":"total_available"}`

### Test snapshot endpoint:
```bash
curl -X POST https://your-project.vercel.app/api/update \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_API_KEY" \
  -d '{
    "account": "Apex-Test-1",
    "total_available": 51234.56,
    "drawdown_auto": 49100.00,
    "dist_drawdown": 2134.56,
    "dollar_open": -45.00,
    "dist_to_daily_loss": 955.00,
    "trailing_max": 2000.00
  }'
```
Expected: `{"status":"ok","mode":"snapshot"}`

### Check the data endpoint:
```bash
curl https://your-project.vercel.app/api/data
```
Expected: JSON object with your account as a key.

### Check debug items:
```bash
curl https://your-project.vercel.app/api/debug/items
```

---

## Shutdown checklist (old stack)

Once you've confirmed NT8 data is flowing to Vercel and the iPhone dashboard is live:

1. Stop the FastAPI server: `Ctrl+C` in the terminal running `main.py`
2. Stop ngrok
3. You can keep `main.py` and `account_state.json` as backup — they won't interfere

---

## Updating ACCOUNT_SIZE_PROFILES

If you need to adjust Apex tier thresholds, edit `lib/trading-logic.ts`:

```ts
const ACCOUNT_SIZE_PROFILES: [number, number, number, number, number][] = [
  [140000, 150000, 4000, 1500, 150100],
  [ 90000, 100000, 3000, 1200, 100100],
  [ 45000,  50000, 2000, 1000,  50100],
  [ 20000,  25000, 1000,  500,  25100],
]
```

Same format as `main.py`. Push to GitHub and Vercel redeploys automatically.

---

## Adding a new NT8 item name

If NinjaTrader sends an item name that's not in `ITEM_MAP`, check Vercel logs:
Vercel Dashboard → your project → Functions → View logs

Then add the mapping in `lib/trading-logic.ts`:
```ts
export const ITEM_MAP: Record<string, string> = {
  // ... existing entries ...
  YourNewItemName: 'existing_field_name',
}
```

---

## Local development

```bash
cp .env.example .env.local
# Fill in your Supabase keys

npm install
npm run dev
# Open http://localhost:3000
```

Your local dev server accepts NT8 posts the same way as production.
Useful for testing new item mappings without redeploying.

---

## Cost

- **Vercel Hobby**: Free (hobby projects, no credit card)
- **Supabase Free tier**: 500MB DB, 50,000 Realtime messages/month, 2 projects

For production prop firm monitoring you may want Supabase Pro ($25/mo)
for unlimited Realtime connections and no pausing after 1 week inactivity.
