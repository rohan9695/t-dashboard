---
name: deploy
description: >
  Ship the trader dashboard to production and prove it landed — Cloudflare
  Workers plus the Supabase edge functions, with pre-flight checks and a
  post-deploy verification of every host. Use this whenever the user wants to
  deploy, release, push live, "make it live", update production, or asks
  whether what's on main is actually running. Also use it to check host health
  or diagnose a half-deployed state ("did the edge function go out?", "is
  Netlify configured?"), and when rotating API_KEY, since that has to change in
  several places at once or ingestion stops.
---

# Deploy

Two things make deploying this project risky, and both are silent.

**A partial deploy is worse than no deploy.** Cloudflare and the Supabase edge
function both ingest NT8 batches and share `trading-logic.ts` plus a
hand-duplicated `buildRow`. Shipping one without the other leaves two live
ingestion paths computing different numbers for the same account, and nothing
reports the disagreement. Never stop after Cloudflare.

**Nothing here auto-deploys.** Pushing to `main` does not make anything live
(Netlify's builds are paused). Never tell the user something is fixed because
it is merged — check what is actually running.

## Pre-flight

Refuse to deploy on a red or unknown signal. Run from the repo root:

```bash
git status --short          # must be clean — deploying an unpushed tree ships
                            # commits CI never saw, which has happened here
git log --oneline -1        # note the sha; you will confirm it went live
npm test                    # ~6 min, the whole suite
```

If the working tree is dirty, stop and ask. If tests fail, stop — do not deploy
around a failure, and do not assume it's flaky. This suite has caught real
defects that passed by eye.

## Deploy — all targets, in this order

**1. Cloudflare Workers** (dashboard + primary ingestion)

```bash
npm run deploy    # scripts/deploy.ps1 — Windows
```

That wrapper exists because plain `npx wrangler deploy` crashes on the user's
Windows machine (`ERR_RUNTIME_FAILURE`, a workerd access violation when wrangler
delegates to `opennextjs-cloudflare deploy`). It renames `open-next.config.ts`
around the deploy and restores it in a `finally`. On Linux/CI, `npm run cf:build
&& npx wrangler deploy` is fine.

**2. Supabase edge functions** (second ingestion path)

```bash
npx supabase functions deploy batch-update  --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl
npx supabase functions deploy sync-accounts --no-verify-jwt --project-ref gvbtnsktudmgmpamkhnl
```

Both, whenever `supabase/functions/_shared/trading-logic.ts` changed — they
share it. `keep-warm` only needs redeploying if it changed itself.

**3. Netlify** (backup UI, failover ingestion) — deploys from `main` via its
GitHub link, but **builds are paused in the UI**, so a push alone does nothing.
Unpausing and triggering are dashboard actions; you cannot do them. Say so
rather than implying it went out.

## Verify — always, and never skip it

```bash
npm run verify
```

Checks `/api/health` on Cloudflare and Netlify, and confirms the edge function
answers `401` to an unauthenticated call (which proves it is deployed and
checking keys). Exits non-zero if any host is unhealthy, and distinguishes
"one ingestion path down" from "both down", because those are very different
situations.

Read the output honestly:

- `missing env: X` — that variable is unset on that host. Dashboard action.
- `env present but database denied` — the key is set but **wrong**, or Supabase
  is refusing it. A present variable is not a working one.
- `no JSON` — not deployed, or something in between answered. Do not assume.

Then confirm the sha you noted is what's running, rather than trusting that the
command printed success.

## Rotating API_KEY

It lives in four places and they must agree or ingestion stops dead. Expect
401s in the gap, so do this while the user is flat, never mid-trade.

1. Cloudflare Worker variables → `API_KEY`
2. `npx supabase secrets set API_KEY=<new> --project-ref gvbtnsktudmgmpamkhnl`
3. Netlify environment variables (only if that site is in use)
4. `AccountMonitor.cs` → recompile in NinjaScript. **Do this last** — ingestion
   resumes at this step.

A 401 is invisible in NT8: the addon logs HTTP failures through
`Debug.WriteLine`, which never reaches the Output window. So verify with
`npm run verify` and by watching `last_update` advance, not by looking for
errors that will not appear.

## What you cannot do

Be explicit about these rather than leaving them implied — the user will
otherwise assume a deploy covered them.

- Setting environment variables (Cloudflare, Netlify, Supabase dashboards)
- Unpausing Netlify builds
- Pasting and compiling the NT8 addon
- Reading the NT8 Output window
- Comparing figures against Apex

When one of these blocks the outcome, say which, and what you would check once
they have done it.

## Making this go away

Three repo secrets — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_ACCESS_TOKEN` — let `.github/workflows/deploy.yml` do all of the
above on every push to `main`, tests gating it. The workflow is written and
gated so it stays dormant until they exist. Worth suggesting whenever the user
is doing this by hand again.
