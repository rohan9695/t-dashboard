---
name: dashboard-triage
description: >
  Diagnose the trader dashboard when it looks stale, frozen, blank, or wrong —
  figures not moving, REALIZED stuck at $0.00, accounts missing from the list,
  "is this actually live?", "shows nothing", "not updating", "numbers don't
  match NinjaTrader". Use this skill whenever the user reports anything off
  about what the dashboard is displaying, even in passing and even if they
  don't ask for a diagnosis — they are usually looking at real money while they
  ask, so reach for this before reading code or forming theories. Also use it
  when asked whether data is arriving, why an account vanished, or why a figure
  disagrees with NT8.
---

# Dashboard triage

This dashboard is a risk display for live prop-firm accounts. When the user
says something is wrong, they may be in a position right now. Two consequences
shape everything below:

- **Diagnose before you touch anything.** A fix that lands 20 minutes later is
  worth less than an accurate answer in 60 seconds. Resist the urge to open
  source files and theorise — the running system will tell you what's wrong
  faster than the code will.
- **Never say "it's fine" without evidence.** Every serious outage this project
  has had looked healthy from the outside. That is the defining characteristic
  of its failure modes, not an accident.

## The trap that catches everyone, including you

The age shown next to the Refresh button is **`lastSync`** — how long since the
*browser* last fetched (`components/RefreshButton.tsx`). It is **not** data
age. It can read "1s ago" while NT8 has been dead for an hour, because the
phone successfully asked a healthy server for the same stale row.

Data freshness lives in exactly two places:

- the **per-row dot colour** — green `<10 min`, amber `≥10 min`, grey `>30 min`
- the row's own `last_update`

Read those. Never quote "Ns ago" back to the user as if it means the data is
fresh.

## Step 1 — What is the dashboard already telling you?

The banners exist precisely to separate causes. Identify which is showing
before doing anything else.

| Banner | Exact wording | What it means | Where to look next |
|---|---|---|---|
| `SyncBanner` | "Dashboard not updating —" or "Showing saved data from …" | The **browser** can't reach the backend. 3 failed polls. NT8 may be perfectly fine. | Phone signal, host status. Not NT8. |
| `HeartbeatMonitor` | "NinjaTrader offline — no data for N" | **NT8** stopped sending, across every account. | The addon, its API key, the broker connection. |
| `CopierBanner` (worst) | "Replikanto not copying — leader is in a position, N of M still flat" | Leader holds a position past a 45s grace while live followers sit flat. | Replikanto itself, inside NT8. |
| `CopierBanner` | "N accounts not reporting (…1234) — a trade now would reach X of Y" | Some accounts fell behind the freshest one, or were hidden. | Per-account, not systemic. |
| **No banner at all** | — | Backend reachable, NT8 recently delivered. The problem is the *values*, not the pipe. | Step 3. |

A green dot with no banner does **not** mean healthy. It means a write landed
within 10 minutes. Go to step 3.

## Step 2 — Rule out the boring explanation

Before treating slowness as a fault, check the flush window. The NT8 addon
flushes every **3s during 9:00–12:59 on weekdays** (local NT8 clock) and every
**30s** outside that. Rows reading 20–30s old outside the window are working as
designed — this is deliberate, to stay inside free-tier limits. Do not
"fix" it.

Also: between trades NT8 has little to say. Figures not moving is not the same
as figures not arriving.

## Step 3 — Get ground truth from the row itself

```
https://t-dashboard.rohan9695.workers.dev/api/data?all=1
```

Open in **Safari** after Face ID *in Safari* — the home-screen PWA has a
separate cookie jar and its session won't carry over. `?all=1` skips the 30
minute cutoff and returns hidden rows too, which the dashboard itself does not
show.

Read these five fields for the account in question:

| Field | Reading it |
|---|---|
| `last_update` | When a write actually landed. **This** is data age. |
| `last_batch_ts` | NT8 machine-clock ms of the last applied batch. Far in the future ⇒ that machine's clock is skewed. |
| `nt_fields` | Which fields NT8 owns. Anything absent is the fallback profile *guessing*, not NT8's number. |
| `hidden` | `true` ⇒ `sync-accounts` stopped seeing it in NT8's live list. |
| `status` | `breached` is computed, and is only as trustworthy as `dist_drawdown` — see below. |

`nt_fields` is the highest-value field here and the one most often skipped. If
`drawdown_auto` / `dist_drawdown` are absent, every drawdown figure on screen
is derived from a balance-guessed profile table and can legitimately disagree
with Apex. If `realized_pnl` is absent, the daily rollover zeroes it — which is
why REALIZED can read `$0.00` all session.

## Step 4 — Compare against NinjaTrader itself

NT8 is the source of truth. Ask the user what **NinjaTrader's own Accounts
panel** shows for the same account, and how many accounts show as connected.

This one question resolves more cases than any amount of code reading:

- **NT8 agrees with the dashboard** ⇒ the dashboard is reporting faithfully and
  the problem is upstream in NT8/the broker. Say so plainly; don't go hunting
  in this repo.
- **NT8 disagrees** ⇒ the value is being lost or transformed in transit. Now
  the code is worth reading.
- **NT8 shows fewer connected accounts than expected** ⇒ accounts genuinely
  dropped. Not a dashboard bug.

## Failure modes that look healthy

These are the ones worth knowing by heart, because each returns success while
losing data.

| Symptom | Cause | Confirm | Fix |
|---|---|---|---|
| Everything frozen, no banner, NT8 Output looks normal | Wrong `API_KEY` ⇒ every POST 401s. **Invisible**: the addon logs HTTP failures via `Debug.WriteLine`, which never reaches the NT8 Output window. | `last_update` stops advancing while NT8 is plainly running | Make the addon's key match Cloudflare **and** Supabase. Roll back to the old key rather than forward, if in doubt. |
| Frozen despite batches being sent | `last_batch_ts` stuck in the future after a clock skew; batches refused with `200 processed:0` | `last_batch_ts` ≫ now | Guarded since the `CLOCK_SKEW_TOLERANCE_MS` fix; if seen again the guard regressed |
| A figure is always `$0.00` | NT8 sends an item name that isn't in `ITEM_MAP`, so it's discarded on arrival | POST a batch and read `unknown[]` in the reply | Add the name to `ITEM_MAP`, and rank it in `ITEM_PRIORITY` rather than leaving it unmapped |
| Account list shorter than expected | `sync-accounts` hid accounts from a partial live list during NT8 startup churn | `hidden: true` with a recent `last_update` | Reload the addon in NinjaScript (F5) — a fresh load re-POSTs the full live list and un-hides them |
| Dashboard blank or "No accounts connected" while accounts exist | RLS denies the anon read and returns `[]`, not an error | `/api/data?all=1` has rows but the page doesn't | The `/api/data` fallback should cover this; if not, that path broke |

## Recovery actions

Reloading the addon in NinjaScript (F5) is the safest first move for anything
account-list shaped: it re-subscribes and re-POSTs the live list, and needs no
credentials.

Manual re-sync, if ever needed:

```bash
curl -X POST https://gvbtnsktudmgmpamkhnl.supabase.co/functions/v1/sync-accounts \
  -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"live_accounts":["PAAPEX…007"]}'
```

There is **no killswitch** — it was removed deliberately. Emergency stop is
disabling the edge function from the Supabase dashboard.

## Things not to do

- **Don't grant `anon` SELECT on `accounts`.** The anon key ships in the JS
  bundle; that would publish every balance to anyone viewing source.
- **Don't change the 9–1 flush window.** It's deliberate.
- **Don't make visual/CSS changes** as part of a fix unless asked. The user
  wants the numbers to look exactly as they do.
- **Don't deploy Cloudflare without the Supabase edge functions.** They share
  ingestion logic; shipping one leaves the two paths disagreeing.
- **Don't report "fixed" for anything not yet deployed.** Cloudflare does not
  auto-deploy from `main`.

## Closing the loop

Finish by telling the user which of these it was, in one line, and what
evidence settled it. If the evidence was inconclusive, say that instead of
picking the most likely story — on a risk display, a confident wrong diagnosis
costs more than an honest "I need one more number from you".
