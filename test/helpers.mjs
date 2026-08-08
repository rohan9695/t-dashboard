// test/helpers.mjs
// Shared fixtures and mock-control helpers for the integration suites.

export const APP    = process.env.TEST_APP_URL   ?? 'http://127.0.0.1:3100'
export const DB     = process.env.TEST_DB_URL    ?? 'http://127.0.0.1:54321'
export const NTFY   = process.env.TEST_NTFY_URL  ?? 'http://127.0.0.1:8099'
export const API_KEY = process.env.TEST_API_KEY  ?? 'test-api-key'

// The app stamps the trading day in Chicago time; fixtures must agree or every
// row looks like a new session and gets its P&L reset.
export const today = () =>
  new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  })

/** A settled account already trading today — the baseline for most fixtures. */
export function account(id, balance, overrides = {}) {
  return {
    account_id: id,
    dollar_open: 0,
    unrealized_pnl: 0,
    realized_pnl: 0,
    total_available: balance,
    net_liq: balance,
    drawdown_auto: 48000,
    trailing_max: 2000,
    dist_drawdown: Math.max(0, balance - 48000),
    dist_to_daily_loss: Math.max(0, 1000 - Math.max(0, 50000 - balance)),
    peak_balance: 50000,
    day_start_balance: 50000,
    day_date: today(),
    source: 'ninjatrader',
    nt_fields: ['total_available'],
    last_update: new Date().toISOString(),
    status: 'active',
    hidden: false,
    last_batch_ts: 1000,
    ...overrides,
  }
}

// ── mock control ────────────────────────────────────────────────────────────
export const resetAll = async () => {
  await fetch(`${DB}/__reset`)
  await fetch(`${NTFY}/__reset`)
}
export const seed         = (row) => fetch(`${DB}/__seed`, { method: 'POST', body: JSON.stringify(row) })
export const storedAccounts = () => fetch(`${DB}/__accounts`).then((r) => r.json())
export const storedTrades   = () => fetch(`${DB}/__trades`).then((r) => r.json())
export const notifications  = () => fetch(`${NTFY}/__notifications`).then((r) => r.json())
export const resetQueries   = () => fetch(`${DB}/__resetQueries`)
export const queryCount     = () => fetch(`${DB}/__queries`).then((r) => r.json()).then((j) => j.accountQueries)
export const failUpsertFor  = (id) => fetch(`${DB}/__failUpsert?id=${encodeURIComponent(id)}`)

// ── app requests ────────────────────────────────────────────────────────────
export const postJson = (path, body, key = API_KEY) =>
  fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
    body: JSON.stringify(body),
  })

export const getJson = (path, key = API_KEY) =>
  fetch(`${APP}${path}`, { headers: { 'X-Api-Key': key } })
