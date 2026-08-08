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
| `NTFY_TOPIC` | ntfy.sh topic for phone alerts. **Unset = notifications off** (endpoint still records fills). Treat as a secret: anyone who knows the topic can read the alerts, so use a long random name. |
| `NTFY_SERVER` | Optional, defaults to `https://ntfy.sh` |

> **Note**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also hardcoded as fallbacks in `lib/supabase/client.ts` and `lib/supabase/server.ts` due to a Vercel env var issue encountered during setup.

---

## File Structure

```
app/
  page.tsx               — Server component, fetches initial accounts, renders dashboard
  layout.tsx             — Root layout, PWA meta tags
  globals.css            — Tailwind base styles
  error.tsx              — Route error boundary (never leave a blank page)
  global-error.tsx       — Root error boundary
  api/
    batch-update/route.ts— POST endpoint, receives NT8 batches, upserts to Supabase
    data/route.ts        — GET endpoint, returns all accounts as JSON (?all=1 skips cutoff)
    sync-accounts/route.ts— POST live account list, soft-hides accounts NT8 dropped
    heartbeat/route.ts   — keep-warm ping target
    set-leader/route.ts  — POST { account_id } to set the Replikanto leader
    trade-event/route.ts — POST one fill round: writes trade_events rows and
                           sends ONE ntfy phone alert
    debug/items/route.ts — GET endpoint, returns ITEM_MAP for debugging
    auth/*               — WebAuthn (Face ID) registration and login

components/
  RealtimeProvider.tsx   — Supabase Realtime WebSocket subscription, React context
  AccountsGrid.tsx       — Table of all accounts
  AccountCard.tsx        — Single account row in the table (also exports AccountRow)
  SummaryBar.tsx         — Total accounts / balance / profit summary cards
  SyncBanner.tsx         — "saved data" / "not updating" degraded-mode banner
  HeartbeatMonitor.tsx   — "NT8 offline" banner (separate cause from SyncBanner)
  RefreshButton.tsx      — Manual re-pull + realtime resubscribe
  CopierBanner.tsx       — "Replikanto not copying" (leader open, followers flat)

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

### NT8 → `/api/batch-update`
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
- `accounts` / `alerts`: SELECT granted to the **`authenticated`** role only.
  The browser client uses the **anon** key, so its direct reads of `accounts`
  are denied — and under RLS a denied SELECT returns an **empty array, not an
  error**, which is silently indistinguishable from "no accounts exist".
  `RealtimeProvider` therefore falls back to `/api/data?all=1` (service role,
  gated by middleware + `td_session` cookie) whenever a direct read comes back
  empty. Realtime events are subject to the same RLS, so the 3s poll — not the
  WebSocket — is what actually keeps the dashboard live.
  > Do **not** "fix" this by granting `anon` SELECT on `accounts`: the anon key
  > is hardcoded in `lib/supabase/client.ts` and ships in the JS bundle, so that
  > would publish every account balance to anyone who opens the page source.
- `service_role`: bypasses RLS (used by the server-side API routes)

---

## NinjaTrader Addon (`AccountMonitor.cs`)
- Subscribes to `AccountItemUpdate` events, only for accounts with `Connection.Status == Connected` (excludes demo/backtest/disconnected accounts)
- Batches updates and POSTs to the batch-update endpoint with `X-Api-Key` header, fanned out in parallel to both always-on targets (`ApiUrls` array in the C# file: Cloudflare + Supabase edge function; Netlify is `FailoverUrl`, hit only when both primaries fail; Vercel intentionally absent, see Known Issues)
- Flush interval is time-of-day aware: 3s during the usage window (9am-1pm weekdays, local NT8 clock), 30s otherwise, to limit free-tier request volume when nobody's watching
- Also reports its live account list on change (not on a timer) to `/api/sync-accounts`, which soft-hides accounts NT8 no longer reports (never hard-deletes)

---

## Apex Prop Firm Account Profiles
**NT8 is the source of truth for risk numbers.** Any of `dist_drawdown`,
`dist_to_daily_loss`, `drawdown_auto`, `trailing_max` that NT8 reports directly
is stored and displayed exactly as sent — the dashboard must not disagree with
the number on the trading screen. Ownership is tracked per field in
`accounts.nt_fields`.

The profile table below is a **fallback only**, applied to fields NT8 never
sent, so an account whose addon reports just equity still gets a usable risk
readout. It auto-detects account size from balance:

| Size | Starting | Trailing Max | Daily Loss | Safety Floor |
|---|---|---|---|---|
| 150K | $150,000 | $4,000 | $1,500 | $150,100 |
| 100K | $100,000 | $3,000 | $1,200 | $100,100 |
| 50K  | $50,000  | $2,000 | $1,000 | $50,100  |
| 25K  | $25,000  | $1,000 | $500   | $25,100  |

> Known trade-off: NT8 has been seen reporting `0` for these fields while equity
> was clearly non-zero. Such a `0` now displays as a zero buffer and flags the
> account `breached`. That is deliberate — a visible false alarm that clears on
> the next update beats the previous behaviour, where a balance-guessed profile
> could show a healthy buffer on an account that was actually in trouble.

---

## Rules for AI Tools Working on This Project

1. **Never delete files without asking the user first**
2. **Never commit secrets** — `SUPABASE_SERVICE_ROLE_KEY` and `API_KEY` must stay in each host's env vars only
3. **Push to `main` only** — Netlify auto-deploys from `main` via its GitHub link; Cloudflare does NOT auto-deploy and needs a manual `wrangler deploy` (see deployment memory) after every change that should go live there. The old `vercel/react-server-components-cve-vu-7f5ap6` branch is no longer force-pushed to since Vercel was dropped — leave it as-is.
4. **Keep ITEM_MAP in sync** — if you add NT8 item names, update `lib/trading-logic.ts` ITEM_MAP. Also: `supabase/functions/_shared/trading-logic.ts` is a mirror copy of `lib/trading-logic.ts` for the Deno edge functions — any change to the lib file must be copied there and the `batch-update`/`sync-accounts` edge functions re-deployed (`npx supabase functions deploy <name> --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl`)
   - **ITEM_PRIORITY** — when several NT8 items map to the *same* field but don't mean the same thing, rank them in `ITEM_PRIORITY` (higher wins) instead of relying on payload order. `total_available` has three sources and only `NetLiquidation` includes open-position P&L; `CashValue` doesn't move while a position is open, so letting it land last freezes equity — and `dist_drawdown` / `dist_to_daily_loss` are both derived from `total_available`, so the whole risk display freezes with it. Unranked items stay priority 0 (last-wins).
5. **TypeScript casts** — when casting `AccountRow` to a generic object, always use `as unknown as Record<string, unknown>` (double cast), not a direct cast
6. **Runtime** — `/api/batch-update`, `/api/data`, `/api/debug/items` must NOT declare `export const runtime = 'edge'`. They run on the default Node.js runtime everywhere (Cloudflare, Netlify) since `@opennextjs/cloudflare` cannot bundle a mixed edge/node route set without extra config — declaring edge on these breaks the Cloudflare build (`OpenNext requires edge runtime function to be defined in a separate function`). Avoid Node.js-only APIs in these routes anyway so they stay portable. Auth routes under `/api/auth/*` intentionally use `export const runtime = 'nodejs'` for `@simplewebauthn/server` compatibility — that's fine, they're not part of this constraint.
7. **Supabase client vs server** — never import `lib/supabase/server.ts` in client components. Use `lib/supabase/client.ts` for browser code only
8. **Local build test** — always run `npm run build` (and `npm run cf:build` if the change touches API routes) locally before pushing to catch errors before they hit either host
9. **`hidden` flag invariant** — `accounts.hidden` is owned exclusively by the sync-accounts auto-hide (there is NO manual-hide UI). batch-update MUST keep forcing `row.hidden = false` when it writes live data: an account actively sending data is live by definition. Never remove that line, and never add read-modify-write round-tripping of flags owned by another endpoint. Incident 2026-07-14: two live LFE accounts vanished from the dashboard because a partial live list during NT8 startup churn hid them, and batch-update's full-row upsert wrote the stale `hidden=true` back after sync-accounts un-hid them — stuck forever since sync only fires on list change. Manual recovery, if ever needed: POST the full live list to `functions/v1/sync-accounts` with the `X-Api-Key` header
10. **Cloudflare deploy on this Windows machine** — plain `npx wrangler deploy` fails (`ERR_RUNTIME_FAILURE`: workerd access violation when wrangler delegates to `opennextjs-cloudflare deploy`). Use the rename workaround in PowerShell: `Rename-Item open-next.config.ts open-next.config.ts.bak; npx wrangler deploy; Rename-Item open-next.config.ts.bak open-next.config.ts` (after `npm run cf:build`)

---

## Degraded-mode behaviour (why the dashboard should never be blank)
The dashboard is a risk display, so it must always render something and always
say how old it is. Three layers, in order:

1. **Server render** — `getInitialAccounts()` is time-boxed to 2s with an
   `AbortSignal`. Supabase being *slow* used to be worse than it being *down*:
   an unbounded await blocked the whole page until it answered.
2. **Client cache** — every successful read is mirrored to `localStorage`
   (`td_accounts_cache`) and painted instantly on load, so an unreachable
   backend shows the last known figures rather than "No accounts connected",
   which is indistinguishable from genuinely having no accounts.
3. **Banners** — `SyncBanner` says either *"Showing saved data from N"* (rows
   came from cache) or *"Dashboard not updating"* (3 consecutive failed
   fetches). `HeartbeatMonitor` is separate and means NT8 stopped sending —
   different cause, different fix, so never merge the two.

Both reads in `fetchAccounts()` are time-boxed (1.5s direct, 4s fallback).
An unreachable host does not always refuse quickly — measured at >3s here — and
an unbounded read stalls every cycle on the dead path before trying the one that
works. A poll that overruns the 3s interval is skipped rather than stacked.

`app/error.tsx` and `app/global-error.tsx` catch render exceptions; without them
one malformed row blanked the entire page.

> There is **no killswitch**. It was removed deliberately: it ran a blocking
> Supabase fetch on every `/api/*` request (including every NT8 batch), only
> covered the Next.js hosts so it could never actually stop ingestion reaching
> the edge function, and a stuck one was indistinguishable from an outage.
> Emergency stop = disable the edge function from the Supabase dashboard.

## Open items (handoff — 2026-08-07)

Everything below is merged to `main` and DEPLOYED (Cloudflare + all three
Supabase edge functions). Total Accounts reading 5 confirmed the new build live.

### Findings from live `nt_fields` (2026-08-07)
All 5 accounts report: `unrealized_pnl`, `total_available`, `realized_pnl`,
`tradovate_margin_used`.

- **Good:** `unrealized_pnl` IS reported, so `CopierBanner`'s "not copying"
  detection works as built. No addon change needed for it.
- **`drawdown_auto` and `dist_drawdown` are NOT reported by any account.** Every
  drawdown figure on the dashboard is the fallback profile's guess, never NT8's.

**Suspected false breaches — do not trust the breach flags until checked.**
4 of 5 accounts read `breached`. Working backwards from `...091`
(balance 47,946.54, `dist_drawdown` -1391.04) the stored threshold must be
49,337.58, which with `trailing_max` 2000 implies a `peak_balance` of
**51,337.58**. If those accounts never actually reached ~51.3k, the breaches are
computed, not real.

Two candidate causes, both worth checking before trusting any of it:

1. **`peak_balance` was poisoned by the CashValue bug.** Until this session,
   `CashValue` could overwrite `NetLiquidation` in `total_available`. CashValue
   excludes open-position P&L, so during a LOSING trade it reads HIGHER than true
   equity — and `peak_balance` only ever moves up and is persisted. Fixing the
   ingestion does not undo an inflated peak already in the table. With a correct
   peak of 50,000, only two accounts sit marginally negative (-53.46 and -0.78),
   not four at -1391.
2. **The trailing-max bucket may be wrong.** `detectAccountProfile` gives
   `PAAPEX`/`LFE` 50k accounts 2500 and everything else 2000. If Apex actually
   applies 2500 to these `APEX…` accounts too, every threshold is 500 too high
   and pushes accounts toward false breach. Verify against Apex's own figures.

**Next step:** compare the dashboard's DD Buffer against what Apex/NinjaTrader
shows for the same account. If they disagree, reset `peak_balance` (set it to
the true high-water mark, or to the current balance to let it re-accumulate) and
confirm the trailing-max bucket. Better still, have the addon subscribe to
`TrailingDrawdownValue` → `tradovate_trailing_drawdown`, which is Apex's real
number and removes the guessing entirely — the addon already sends
`tradovate_margin_used`, so it is reaching those fields already.

### Do first
1. **Rotate `API_KEY`** — it was pasted into a chat transcript, so treat it as
   public. Whoever holds it can write fake account data, fire fake phone alerts,
   and read every balance via `/api/data`. Change it in all four places or
   ingestion stops: Cloudflare Worker vars → `npx supabase secrets set API_KEY=…
   --project-ref gvbtnsktudmgmpamkhnl` → Netlify vars (if still set) →
   `AccountMonitor.cs`. Do NT8 last; expect 401s until all four agree.
2. **Push local `main`.** A deploy was run from an unpushed working tree, so the
   live build contained commits CI never saw. `origin/main` and production must
   match before the auto-deploy is switched on, or GitHub will overwrite live
   with a different build.
3. **Check `nt_fields`** for the leader in `/api/data` (Safari, after Face ID *in
   Safari* — the home-screen PWA has a separate cookie jar). If neither
   `unrealized_pnl` nor `dollar_open` is listed, NT8 is not sending open P&L, so
   `CopierBanner`'s "not copying" case can never fire and the addon needs to
   subscribe to `UnrealizedProfitLoss`. The readiness warning and the ntfy
   partial-fill alert work either way.

### To finish the automation
4. Add three repo secrets so deploys stop being manual: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`. Until then `deploy.yml`
   runs the tests and skips the deploy steps.
5. Set **`NTFY_TOPIC`** in Cloudflare vars — unset means notifications are
   silently off, though fills are still recorded.

### Known, not yet done
- **Column overlap**: a 4-digit P&L collides with Net Liq in the mobile list
  row. Pre-existing. Left alone on request — no CSS changes for now.
- **`ToastProvider`** subscribes to `trade_events`, which only `/api/trade-event`
  writes. Until the NT8 addon posts fills there, in-page toasts never fire.
- **NT8 addon changes** (not in this repo): POST one call per fill round to
  `/api/trade-event` with `accounts[]` + `total_accounts`; subscribe to
  `UnrealizedProfitLoss` if item 3 shows it missing.
- **Netlify "never working"** — unverified. Most likely its env vars were never
  set, so every request 500s. Check its deploy log and env panel.
- **One writer, not three**: collapse the parallel fan-out to Supabase-primary
  with Cloudflare as sequential failover. Removes the `last_batch_ts` race guard
  and the hand-synced duplicate of `trading-logic.ts`. Needs an addon change.

### Testing
`npm test` (full, ~6 min) · `npm run test:unit` (~300ms) · `npm run sandbox`
(mock stack on :3100, prints a phone URL). CI runs the lot on every push and is
the source of truth — it caught two defects that passed locally, including the
browser being hardcoded to the production database.

## Known Issues / History
- Vercel was dropped from active hosting (account disabled, HTTP 402 billing issue) — the `vercel/react-server-components-cve-vu-7f5ap6` branch it auto-created is no longer kept in sync, left as historical
- `NEXT_PUBLIC_SUPABASE_URL` was incorrectly set to the Supabase dashboard URL instead of the API URL during initial setup — hardcoded fallbacks were added to `client.ts` and `server.ts` to prevent this from breaking the app again
- Next.js was upgraded from `15.1.0` → `15.5.19` to resolve CVE-2025-66478

---

## Replikanto (trade copier)
`accounts.replikanto_role` is `'leader' | 'follower' | null`. It drives the
LEADER badge, sorting the leader to the top, and `CopierBanner`.

`CopierBanner` shows two problems, worst first:

**1. Not copying** (during a trade) — the leader holds an open position
(`dollar_open != 0`) for longer than a 45s grace period while a live follower is
still flat. Offline followers (>30 min silent) are excluded; they were never
going to fill.

**2. Not ready** (needs no trade) — an account has stopped reporting while the
others carry on, so a trade fired now could not reach it. This is the pre-trade
warning: it does not wait for money to be at risk.

The readiness check compares each account against the **freshest** account
rather than against the clock. NT8 sends every account in one batch, so their
timestamps move together — a relative comparison is what separates "NT8 is quiet
right now" (all equally old, nothing wrong) from "this account dropped" (one far
behind the rest). Every other staleness check in the app is absolute and cannot
make that distinction. Threshold is 3 minutes, several missed batches even at
the 30s out-of-window flush rate.

> **This cannot tell you whether Replikanto itself is connected.** That state
> lives inside NinjaTrader and nothing reports it here. Accounts reporting is a
> precondition for copying, not proof of it. For Replikanto's own status the NT8
> addon would have to read it and POST it.

> Depends on **open P&L being reported**. `dollar_open` comes from NT8's
> `UnrealizedProfitLoss` / `DollarOpen` items; if the addon does not subscribe
> to them every account reads flat and this can never fire. Check `nt_fields`
> per account in `/api/data` to see what NT8 actually sends.

The addon-side equivalent is the partial-fill ntfy alert below, which works with
the phone locked — the banner needs the page open. They are deliberately
independent.

**Setting the leader** (no UI — the Settings page was deleted):
```
curl -X POST https://<host>/api/set-leader -H "X-Api-Key: $API_KEY" \
     -H 'Content-Type: application/json' -d '{"account_id":"PAAPEX…007"}'
```

## Fill notifications
The NT8 addon POSTs **one call per fill round** to `/api/trade-event`, listing
every account that filled plus `total_accounts` (how many were expected to). The
addon is the only place that sees the whole round, so aggregating there is what
keeps a five-account fill to a single phone alert instead of five.

The endpoint writes one `trade_events` row per account — which is what the
in-page `ToastProvider` toast subscribes to over Realtime — and sends one ntfy
notification. When fewer accounts filled than expected the alert is escalated to
**urgent** priority so it breaks through a silenced phone; that mismatch is the
entire point of the feature.

```
POST <host>/api/trade-event      X-Api-Key: $API_KEY
{ "symbol": "ES", "direction": "long", "event_type": "open",
  "accounts": ["PAAPEX…007", "APEX…089"], "total_accounts": 5, "quantity": 1 }
```
`event_type`: open | close | partial · `direction`: long | short | flat ·
`pnl` only stored on a close. Accounts starting `sim` are ignored.

## Planned Features (Not Yet Built)
- Alert when drawdown buffer drops below threshold
