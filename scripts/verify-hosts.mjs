// scripts/verify-hosts.mjs
// Asks every host whether it is actually configured and serving, and prints one
// table. Run it after any deploy — or any time the dashboard looks wrong and you
// want to rule the hosts in or out.
//
//   npm run verify
//
// Why this exists: for months nobody could say whether Netlify worked, because
// a missing env var does not announce itself — lib/supabase/server.ts falls back
// to '' and the routes just 500. /api/health turns that into a straight answer,
// and this turns three straight answers into one.
//
// Exits non-zero if any host is unhealthy, so it can gate a deploy script.

const HOSTS = [
  { name: 'Cloudflare (primary)', url: 'https://t-dashboard.rohan9695.workers.dev' },
  { name: 'Netlify (backup UI)',  url: 'https://t-dashboard-971.netlify.app' },
]

// The edge function has no /api/health — it is a single function, not the app.
// A 401 from it is a HEALTHY answer: it means the function is deployed and
// checking keys. Anything else means it is not there.
const EDGE = {
  name: 'Supabase edge fn',
  url: 'https://gvbtnsktudmgmpamkhnl.supabase.co/functions/v1/batch-update',
}

const TIMEOUT_MS = 8_000

async function fetchJson(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, body, text }
  } finally {
    clearTimeout(timer)
  }
}

async function checkApp(host) {
  try {
    const { status, body } = await fetchJson(`${host.url}/api/health`)
    if (!body) {
      // Not deployed is only one explanation. A corporate proxy, captive portal
      // or CDN error page also answers with non-JSON, and saying "not deployed"
      // when something in the middle replied sends you debugging the wrong box.
      return {
        ...host, ok: false, status,
        detail: `HTTP ${status}, no JSON — /api/health not deployed, or something in between answered`,
      }
    }
    if (body.ok) return { ...host, ok: true, status, detail: `configured, database ${body.database}` }

    const missing = (body.missing ?? []).join(', ')
    const detail = missing
      ? `missing env: ${missing}`
      : `env present but database ${body.database}` // wrong key, or Supabase unreachable
    return { ...host, ok: false, status, detail }
  } catch (e) {
    const why = e.name === 'AbortError' ? `no response in ${TIMEOUT_MS}ms` : e.message
    return { ...host, ok: false, status: 0, detail: `unreachable — ${why}` }
  }
}

async function checkEdge() {
  try {
    // No key deliberately: a deployed function answers 401, which is the proof
    // we want. Sending a real key would also write data, which a check must not.
    const { status } = await fetchJson(EDGE.url)
    if (status === 401) return { ...EDGE, ok: true, status, detail: 'deployed, rejecting unauthenticated calls' }
    if (status === 404) return { ...EDGE, ok: false, status, detail: 'HTTP 404 — function not deployed' }
    return { ...EDGE, ok: false, status, detail: `HTTP ${status} — expected 401; a proxy may have answered instead` }
  } catch (e) {
    const why = e.name === 'AbortError' ? `no response in ${TIMEOUT_MS}ms` : e.message
    return { ...EDGE, ok: false, status: 0, detail: `unreachable — ${why}` }
  }
}

const results = await Promise.all([...HOSTS.map(checkApp), checkEdge()])

const width = Math.max(...results.map((r) => r.name.length))
console.log('')
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'}  ${r.name.padEnd(width)}  ${r.detail}`)
}
console.log('')

const bad = results.filter((r) => !r.ok)
if (bad.length === 0) {
  console.log('All hosts healthy.')
  process.exit(0)
}

// Every host failing the same way is far more likely to be this machine than
// three independent outages at once. Saying "production is down" here sends you
// to the wrong box, so check the cheaper explanation first.
if (bad.length === results.length) {
  // Compare the HTTP status, not the prose: three hosts answering an identical
  // status (or all timing out) is a local problem wearing a production costume.
  const statuses = new Set(bad.map((r) => r.status))
  if (statuses.size === 1) {
    console.log('Every host failed identically — suspect this machine first:')
    console.log('  network, VPN, corporate proxy, or DNS. Try one URL in a browser before')
    console.log('  concluding anything about production.')
    process.exit(1)
  }
}

console.log(`${bad.length} host(s) need attention.`)
// Ingestion survives one host being down — that is the point of the fan-out —
// so name what is actually at risk rather than implying everything is broken.
const primaries = bad.filter((r) => r.name.startsWith('Cloudflare') || r.name.startsWith('Supabase'))
if (primaries.length === 2) {
  console.log('BOTH ingestion paths are down — NT8 data is reaching nothing but the Netlify failover.')
} else if (primaries.length === 1) {
  console.log('One ingestion path is down; the other is still accepting batches.')
} else {
  console.log('Ingestion is unaffected — the failing host is the backup UI only.')
}
process.exit(1)
