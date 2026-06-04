# Trader Dashboard — Project Context for AI Tools

## What This Project Is
A real-time prop firm account monitoring dashboard. It replaces a local Python FastAPI server (`main.py`) + ngrok setup with a fully hosted, always-on solution.

**Stack:**
- **Frontend/Backend**: Next.js 15 (App Router, Edge runtime for API routes)
- **Database**: Supabase (PostgreSQL + Realtime WebSocket)
- **Hosting**: Vercel
- **Data source**: NinjaTrader 8 (NT8) C# addon (`AccountMonitor.cs`)

---

## Architecture

```
NinjaTrader 8 (C# addon)
    │
    │  POST /api/update  (X-Api-Key header)
    ▼
Vercel (Next.js)
    │
    │  upsert row
    ▼
Supabase (accounts table)
    │
    │  Realtime WebSocket
    ▼
Browser Dashboard (React)
```

---

## Key URLs
- **Dashboard**: https://t-dashboard-pi.vercel.app
- **API update endpoint**: https://t-dashboard-pi.vercel.app/api/update
- **Supabase project**: https://gvbtnsktudmgmpamkhnl.supabase.co
- **GitHub repo**: https://github.com/rohan9695/t-dashboard

---

## Environment Variables (Vercel)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (read-only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS, server-side only) |
| `API_KEY` | Auth key NT8 addon sends in `X-Api-Key` header |

> **Note**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also hardcoded as fallbacks in `lib/supabase/client.ts` and `lib/supabase/server.ts` due to a Vercel env var issue encountered during setup.

---

## File Structure

```
app/
  page.tsx               — Server component, fetches initial accounts, renders dashboard
  layout.tsx             — Root layout, PWA meta tags
  globals.css            — Tailwind base styles
  api/
    update/route.ts      — POST endpoint, receives NT8 data, upserts to Supabase
    data/route.ts        — GET endpoint, returns all accounts as JSON
    debug/items/route.ts — GET endpoint, returns ITEM_MAP for debugging

components/
  RealtimeProvider.tsx   — Supabase Realtime WebSocket subscription, React context
  AccountsGrid.tsx       — Table of all accounts
  AccountCard.tsx        — Single account row in the table (also exports AccountRow)
  SummaryBar.tsx         — Total accounts / balance / profit summary cards
  StatusBar.tsx          — Header with connection status and clock

lib/
  trading-logic.ts       — Core business logic (ported from main.py):
                           ITEM_MAP, AccountRow type, emptyAccount(),
                           detectAccountProfile(), computeTradovateMetrics(),
                           enrichAccount(), DANGER_THRESHOLD, CAUTION_THRESHOLD
  supabase/
    client.ts            — Browser Supabase client (uses anon key)
    server.ts            — Server Supabase client (uses service role key)

supabase/
  schema.sql             — Full DB schema: accounts, alerts, connection_logs tables,
                           RLS policies, Realtime publication

public/
  manifest.json          — PWA manifest (add to iPhone home screen)
```

---

## Data Flow

### NT8 → Vercel (`/api/update`)
The NT8 addon sends one of three payload shapes:

1. **ItemUpdate** — single field update:
   ```json
   { "account": "PAAPEX123", "item": "CashValue", "value": 50188.00 }
   ```

2. **Snapshot** — full account snapshot:
   ```json
   { "account": "PAAPEX123", "total_available": 50188, "drawdown_auto": 48000, ... }
   ```

3. **FullUpdate** — legacy full update (same fields as snapshot)

### ITEM_MAP (NT8 item name → DB field)
```
NetLiquidation / TotalAvailable / CashValue → total_available
DollarOpen / OpenPnL                        → dollar_open
UnrealizedProfitLoss                        → unrealized_pnl
DistToDailyLoss / DailyLossRemaining        → dist_to_daily_loss
DrawdownAuto / DrawDownAuto                 → drawdown_auto
TrailingMax / TrailingThreshold             → trailing_max
DistDrawdown / DistanceToDrawdown           → dist_drawdown
RealizedProfitLoss / GrossRealizedProfitLoss → realized_pnl
```

---

## Database Schema (Supabase)

### `accounts` table
| Column | Type | Description |
|---|---|---|
| `account_id` | text PK | NT8 account name e.g. "PAAPEX3480290000005" |
| `dollar_open` | numeric | Unrealized / open P&L |
| `dist_to_daily_loss` | numeric | Distance to daily loss limit |
| `drawdown_auto` | numeric | Trailing drawdown threshold |
| `total_available` | numeric | Equity / net liquidation |
| `trailing_max` | numeric | Trailing max value |
| `dist_drawdown` | numeric | Distance to drawdown |
| `unrealized_pnl` | numeric | Unrealized P&L |
| `realized_pnl` | numeric | Realized P&L |
| `net_liq` | numeric | Alias for total_available |
| `peak_balance` | numeric | Peak balance (persisted) |
| `day_start_balance` | numeric | Balance at day start |
| `day_date` | text | Date of day_start_balance |
| `source` | text | 'ninjatrader' or 'computed' |
| `nt_fields` | text[] | Fields NT8 sent directly |
| `last_update` | timestamptz | Last update timestamp |
| `status` | text | 'active', 'stale', or 'breached' |

### RLS Policies
- `anon` role: SELECT on accounts and alerts (dashboard read access)
- `service_role`: bypasses RLS (used by /api/update)

---

## NinjaTrader Addon (`AccountMonitor.cs`)
- Subscribes to `AccountItemUpdate` events for all accounts
- Sends ItemUpdate payloads to `/api/update` with `X-Api-Key` header
- Currently deployed at: hardcoded Vercel URL in the C# file

---

## Apex Prop Firm Account Profiles
The dashboard auto-detects account size and applies correct drawdown rules:

| Size | Starting | Trailing Max | Daily Loss | Safety Floor |
|---|---|---|---|---|
| 150K | $150,000 | $4,000 | $1,500 | $150,100 |
| 100K | $100,000 | $3,000 | $1,200 | $100,100 |
| 50K  | $50,000  | $2,000 | $1,000 | $50,100  |
| 25K  | $25,000  | $1,000 | $500   | $25,100  |

---

## Rules for AI Tools Working on This Project

1. **Never delete files without asking the user first**
2. **Never commit secrets** — `SUPABASE_SERVICE_ROLE_KEY` and `API_KEY` must stay in Vercel env vars only
3. **Push to both branches** when making changes — `main` and `vercel/react-server-components-cve-vu-7f5ap6` (Vercel deploys from both):
   ```
   git push origin main
   git push origin main:vercel/react-server-components-cve-vu-7f5ap6 --force
   ```
4. **Keep ITEM_MAP in sync** — if you add NT8 item names, update `lib/trading-logic.ts` ITEM_MAP
5. **TypeScript casts** — when casting `AccountRow` to a generic object, always use `as unknown as Record<string, unknown>` (double cast), not a direct cast
6. **Edge runtime** — `/api/update`, `/api/data`, `/api/debug/items` all use `export const runtime = 'edge'`. Don't use Node.js-only APIs in these routes
7. **Supabase client vs server** — never import `lib/supabase/server.ts` in client components. Use `lib/supabase/client.ts` for browser code only
8. **Local build test** — always run `npm run build` locally before pushing to catch TypeScript errors before Vercel does

---

## Known Issues / History
- Vercel auto-created a branch `vercel/react-server-components-cve-vu-7f5ap6` for a CVE fix — this branch is kept in sync with `main` via force push
- `NEXT_PUBLIC_SUPABASE_URL` was incorrectly set to the Supabase dashboard URL instead of the API URL during initial setup — hardcoded fallbacks were added to `client.ts` and `server.ts` to prevent this from breaking the app again
- Next.js was upgraded from `15.1.0` → `15.5.19` to resolve CVE-2025-66478

---

## Planned Features (Not Yet Built)
- Push notifications to iPhone when a trade is open on only one account
- Alert when drawdown buffer drops below threshold
