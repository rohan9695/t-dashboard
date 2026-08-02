# Cloudflare Downtime Auto-Failover — Design

## Problem

The dashboard's primary host is Cloudflare Workers. The user experiences real
downtime there periodically. When Cloudflare is unhealthy, the page itself
(HTML/JS) fails to load, so nothing running in the browser can react —
there's no way today to automatically fall back to the working Netlify copy.
The user has to know to try a different link, which they don't, so a
Cloudflare bad moment currently just means the dashboard is unusable until it
recovers.

Goal: one bookmark, that as far as the user can tell, "just always works" —
either it's Cloudflare working normally, or it's silently the Netlify copy,
automatically, both on cold open and if Cloudflare dies mid-session.

## Non-goals

- Not fixing whatever causes Cloudflare instability itself (that's a
  separate investigation if/when it recurs — this spec is purely about not
  being stuck when it happens).
- Not building true DNS-level/invisible-on-first-byte failover — that needs
  a paid product (e.g. Cloudflare Load Balancing) sitting in front of a
  custom domain. This project uses free tiers on both hosts' default
  subdomains, so failover happens in JS after at least one request completes
  (health check), not at the network layer.

## Architecture — three pieces

```
Phone bookmark → GitHub Pages router → health check → Cloudflare (healthy)
                                                     ↘ Netlify (unhealthy)

Already-open dashboard (either host) → periodic self health-check
                                     → redirect to the other host on failure
```

### 1. `/api/health-deep` — a real health check

New route, `app/api/health-deep/route.ts`, deployed on **both** Cloudflare
and Netlify (same route, same code — it needs to answer "am I, the host
currently serving this file, actually working").

- Runs one cheap-but-real Supabase query (`count`-only, `head: true` — no
  row data returned) through the existing service-role client, so it fails
  under the same conditions the real dashboard page would (DB unreachable,
  function erroring, resource limits), unlike a static "I'm alive" ping that
  would stay green while the real page is broken.
- Must be reachable **without authentication** — the GitHub Pages router has
  no session, and embedding the NT8 `API_KEY` or a session cookie in public
  static JS would leak a credential. This means adding `/api/health-deep` to
  `OPEN_PREFIXES` in `middleware.ts`.
- Response is generic and contains no account data: `{ ok: true }` /
  `{ ok: false }`. Never returns balances, account IDs, or anything else
  sensitive — the query only asks Postgres "can you count rows," it doesn't
  select any columns.
- Sends `Access-Control-Allow-Origin: *` so the GitHub Pages origin (a
  different origin than either dashboard host) can read the response via
  `fetch()` — without this header the browser blocks cross-origin reads by
  default.
- No `export const runtime = 'edge'` (CLAUDE.md rule 6 — breaks the
  Cloudflare OpenNext build).

### 2. Router page — `docs/index.html`, hosted on GitHub Pages

This is what replaces the phone's home-screen bookmark. Plain HTML + vanilla
JS, no build step, no framework — it has to work standalone as a static
file.

On load:
1. Show a minimal "Loading dashboard…" message (avoid a blank flash).
2. `fetch()` the Cloudflare `/api/health-deep` with a 3s timeout
   (`AbortController`).
3. Healthy → `location.replace(CLOUDFLARE_URL)`.
4. Unhealthy or timed out → `location.replace(NETLIFY_URL)`.

`location.replace` (not `location.href =`) so the router page itself never
sits in browser history — pressing back from the dashboard won't bounce the
user through it again.

No secrets in this file — just the two public dashboard URLs, hardcoded
(both already documented in CLAUDE.md):
`https://t-dashboard.rohan9695.workers.dev` (Cloudflare) and
`https://t-dashboard-971.netlify.app` (Netlify).

**One-time manual setup** (can't be done from this session — GitHub Pages
activation is an account/repo-settings change): after this is pushed, the
user enables GitHub Pages in repo Settings → Pages → Deploy from branch →
`main` / `/docs`. Free hosting at `https://rohan9695.github.io/t-dashboard/`.
Then replace the phone bookmark with that URL instead of the raw Cloudflare
link.

### 3. In-page watchdog — `components/FailoverWatchdog.tsx`

Handles the case the router page can't: Cloudflare dying *while the tab is
already open and loaded*. Small client component, mounted once in
`app/page.tsx` alongside the other providers.

- Determines its own current host from `window.location.hostname`.
- Every 45s (while `!document.hidden`, matching the pattern already used
  elsewhere in this codebase for pausing background polling), calls its
  *own* `/api/health-deep` (same-origin, no CORS needed here).
- Requires **2 consecutive failures** before acting — a single dropped
  request isn't a real outage, and reacting on the first failure would cause
  false-positive redirects on ordinary network hiccups.
- On 2 consecutive failures: redirect to the other host's dashboard URL.

**Redirect-loop guard**: if Supabase itself is down (not just Cloudflare),
both hosts' health checks fail, and naively this component would bounce the
user Cloudflare → Netlify → Cloudflare → … forever. Guard: before
redirecting, write a `sessionStorage` flag (`td_failover_at`, a timestamp).
On mount, if that flag exists and is less than 2 minutes old, the watchdog
does not redirect again even on failure — it just stops silently (the
existing `HeartbeatMonitor` banner already tells the user when data is
stale, so they're not left with zero signal). This caps it at one hop, ever,
per 2-minute window, instead of an infinite bounce.

## Data flow summary

- **Cold open, Cloudflare healthy**: bookmark → router → health check OK →
  Cloudflare dashboard. Indistinguishable from today, just one extra fast
  request.
- **Cold open, Cloudflare unhealthy**: bookmark → router → health check
  fails/times out → Netlify dashboard, transparently.
- **Already on Cloudflare, it dies mid-session**: watchdog notices within
  ~45-90s (2 failed checks), redirects to Netlify automatically.
- **Both hosts down** (e.g. Supabase outage): router sends to Netlify (still
  fails to load real data, but the page itself loads); watchdog on Netlify
  tries once, hits the loop guard, stops. User sees the existing
  stale-data banner rather than a bounce loop.

## What does NOT change

- The existing dashboard page, its data pipeline, auth (WebAuthnGate), and
  every currently-working route are untouched. This is purely additive: one
  new API route, one new static file, one new small client component, and
  a one-line middleware allowlist addition.
- No change to `lib/trading-logic.ts`, `batch-update`, `sync-accounts`, or
  any account data logic.

## Testing plan

- `npm run build` and `npm run cf:build` locally before pushing (per
  CLAUDE.md rule 8).
- Manually verify `/api/health-deep` returns `{ok:true}` with the CORS
  header from a `curl` with an `Origin` header set, both pre- and
  post-deploy.
- Manually verify the router page's fallback path by temporarily pointing
  `CLOUDFLARE_URL` at a nonexistent path and confirming it lands on Netlify
  within ~3s.
- Manually verify the watchdog's loop guard by simulating two consecutive
  failed health checks (e.g. via browser devtools network throttling/block)
  and confirming exactly one redirect occurs, not a bounce.
- No changes to existing automated tests are needed since no existing
  behavior changes; this is new, isolated surface area.

## Deploy steps (once code is ready)

Same pattern as existing CLAUDE.md deploy steps: push to `main` (Netlify
auto-deploys, including the new `/api/health-deep` route and `docs/`), then
run the existing Cloudflare `wrangler deploy` workaround (rename
`open-next.config.ts` around the deploy — required on this Windows machine
per CLAUDE.md rule 10). GitHub Pages activation is a manual one-time step in
repo settings, not part of the deploy script.
