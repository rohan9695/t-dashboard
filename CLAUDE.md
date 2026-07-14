# Trader Dashboard — Project Context for AI Tools

## What This Project Is
A real-time prop firm account monitoring dashboard. It replaces a local Python FastAPI server (`main.py`) + ngrok setup with a fully hosted, always-on solution.

**Stack:**
- **Frontend/Backend**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL + Realtime WebSocket)
- **Hosting**: Cloudflare Workers (primary, 100k req/day free) + Supabase Edge Functions (second always-on ingestion endpoint, 500k req/month free) + Netlify (failover + backup dashboard UI). The NT8 addon POSTs every batch to Cloudflare and the Supabase edge function in parallel; Netlify only receives a batch when BOTH primaries fail, because its ~125k invocations/month free tier is below the always-on fan-out volume (it hit 50% mid-July 2026, which forced this change). Vercel was dropped from active use (account disabled, HTTP 402 billing issue) — the project still exists and could be re-added to the addon's `ApiUrls` if the billing gets fixed, but is not part of the current setup.
- **Data source**: NinjaTrader 8 (NT8) C# addon (`AccountMonitor.cs`)

---

## Architecture

```
NinjaTrader 8 (C# addon)
    │
    │  POST batch-update  (X-Api-Key header, fanned out in parallel)
    ├───────────────────┬──────────────────────────┐
    ▼                   ▼                          ▼ (failover only —
Cloudflare        Supabase Edge Function        Netlify   fires when both
(primary)         (functions/v1/batch-update)   (backup)  primaries fail)
    │                   │                          │
    └─────────┬─────────┴──────────────────────────┘
              ▼
Supabase (accounts table)
    │
    │  Realtime WebSocket
    ▼
Browser Dashboard (React)
```

---

## Key URLs
- **Dashboard (primary)**: https://t-dashboard.rohan9695.workers.dev
- **Dashboard (backup)**: https://t-dashboard-971.netlify.app
- **Batch update endpoint**: `<host>/api/batch-update`
- **Supabase project**: https://gvbtnsktudmgmpamkhnl.supabase.co
- **GitHub repo**: https://github.com/rohan9695/t-dashboard
- ~~Vercel: https://t-dashboard-pi.vercel.app~~ — dropped, account disabled (402 billing issue)

---

## Environment Variables (Cloudflare + Netlify)
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
- Subscribes to `AccountItemUpdate` events, only for accounts with `Connection.Status == Connected` (excludes demo/backtest/disconnected accounts)
- Batches updates and POSTs to the batch-update endpoint with `X-Api-Key` header, fanned out in parallel to both always-on targets (`ApiUrls` array in the C# file: Cloudflare + Supabase edge function; Netlify is `FailoverUrl`, hit only when both primaries fail; Vercel intentionally absent, see Known Issues)
- Flush interval is time-of-day aware: 3s during the usage window (9am-1pm weekdays, local NT8 clock), 30s otherwise, to limit free-tier request volume when nobody's watching
- Also reports its live account list on change (not on a timer) to `/api/sync-accounts`, which soft-hides accounts NT8 no longer reports (never hard-deletes)

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
2. **Never commit secrets** — `SUPABASE_SERVICE_ROLE_KEY` and `API_KEY` must stay in each host's env vars only
3. **Push to `main` only** — Netlify auto-deploys from `main` via its GitHub link; Cloudflare does NOT auto-deploy and needs a manual `wrangler deploy` (see deployment memory) after every change that should go live there. The old `vercel/react-server-components-cve-vu-7f5ap6` branch is no longer force-pushed to since Vercel was dropped — leave it as-is.
4. **Keep ITEM_MAP in sync** — if you add NT8 item names, update `lib/trading-logic.ts` ITEM_MAP. Also: `supabase/functions/_shared/trading-logic.ts` is a mirror copy of `lib/trading-logic.ts` for the Deno edge functions — any change to the lib file must be copied there and the `batch-update`/`sync-accounts` edge functions re-deployed (`npx supabase functions deploy <name> --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl`)
5. **TypeScript casts** — when casting `AccountRow` to a generic object, always use `as unknown as Record<string, unknown>` (double cast), not a direct cast
6. **Runtime** — `/api/update`, `/api/data`, `/api/debug/items` must NOT declare `export const runtime = 'edge'`. They run on the default Node.js runtime everywhere (Cloudflare, Netlify) since `@opennextjs/cloudflare` cannot bundle a mixed edge/node route set without extra config — declaring edge on these breaks the Cloudflare build (`OpenNext requires edge runtime function to be defined in a separate function`). Avoid Node.js-only APIs in these routes anyway so they stay portable. Auth routes under `/api/auth/*` intentionally use `export const runtime = 'nodejs'` for `@simplewebauthn/server` compatibility — that's fine, they're not part of this constraint.
7. **Supabase client vs server** — never import `lib/supabase/server.ts` in client components. Use `lib/supabase/client.ts` for browser code only
8. **Local build test** — always run `npm run build` (and `npm run cf:build` if the change touches API routes) locally before pushing to catch errors before they hit either host
9. **`hidden` flag invariant** — `accounts.hidden` is owned exclusively by the sync-accounts auto-hide (there is NO manual-hide UI). batch-update MUST keep forcing `row.hidden = false` when it writes live data: an account actively sending data is live by definition. Never remove that line, and never add read-modify-write round-tripping of flags owned by another endpoint. Incident 2026-07-14: two live LFE accounts vanished from the dashboard because a partial live list during NT8 startup churn hid them, and batch-update's full-row upsert wrote the stale `hidden=true` back after sync-accounts un-hid them — stuck forever since sync only fires on list change. Manual recovery, if ever needed: POST the full live list to `functions/v1/sync-accounts` with the `X-Api-Key` header
10. **Cloudflare deploy on this Windows machine** — plain `npx wrangler deploy` fails (`ERR_RUNTIME_FAILURE`: workerd access violation when wrangler delegates to `opennextjs-cloudflare deploy`). Use the rename workaround in PowerShell: `Rename-Item open-next.config.ts open-next.config.ts.bak; npx wrangler deploy; Rename-Item open-next.config.ts.bak open-next.config.ts` (after `npm run cf:build`)

---

## Known Issues / History
- Vercel was dropped from active hosting (account disabled, HTTP 402 billing issue) — the `vercel/react-server-components-cve-vu-7f5ap6` branch it auto-created is no longer kept in sync, left as historical
- `NEXT_PUBLIC_SUPABASE_URL` was incorrectly set to the Supabase dashboard URL instead of the API URL during initial setup — hardcoded fallbacks were added to `client.ts` and `server.ts` to prevent this from breaking the app again
- Next.js was upgraded from `15.1.0` → `15.5.19` to resolve CVE-2025-66478

---

## Planned Features (Not Yet Built)
- Push notifications to iPhone when a trade is open on only one account
- Alert when drawdown buffer drops below threshold
