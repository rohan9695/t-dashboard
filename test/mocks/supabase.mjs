// test/mocks/supabase.mjs
// Stands in for Supabase's PostgREST API so the real API routes can be
// exercised with no network and no real database.
//
// Implements only what the app actually calls. Anything unhandled returns 404
// loudly rather than a plausible-looking empty result, so a route quietly
// depending on something new fails the test instead of passing by accident.
//
// Run standalone:  node test/mocks/supabase.mjs [port]

import http from 'node:http'

const PORT = Number(process.argv[2] ?? process.env.MOCK_SUPABASE_PORT ?? 54321)

const accounts = new Map()
const tradeEvents = []
const failUpserts = new Set()
let accountQueries = 0

const send = (res, code, body) => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : null) } catch { resolve(null) } })
  })

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  // ── Test-control surface (not part of PostgREST) ─────────────────────────
  if (path === '/__accounts') return send(res, 200, [...accounts.values()])
  if (path === '/__trades')   return send(res, 200, tradeEvents)
  if (path === '/__queries')  return send(res, 200, { accountQueries })
  if (path === '/__health')   return send(res, 200, { ok: true })
  if (path === '/__reset') {
    accounts.clear(); tradeEvents.length = 0; failUpserts.clear(); accountQueries = 0
    return send(res, 200, { ok: true })
  }
  if (path === '/__resetQueries') { accountQueries = 0; return send(res, 200, { ok: true }) }
  if (path === '/__failUpsert')   { failUpserts.add(url.searchParams.get('id')); return send(res, 200, { ok: true }) }
  if (path === '/__seed') {
    const row = await readBody(req)
    accounts.set(row.account_id, row)
    return send(res, 200, { ok: true })
  }

  // ── PostgREST surface ────────────────────────────────────────────────────
  // Fire-and-forget writes from middleware; the app never reads these back.
  if (path === '/rest/v1/access_logs')    return send(res, 201, {})
  if (path === '/rest/v1/account_events') return send(res, 201, {})

  if (path === '/rest/v1/trade_events') {
    if (req.method === 'POST') {
      const body = await readBody(req)
      // A bulk insert arrives as an array — store the rows, not the array.
      if (Array.isArray(body)) tradeEvents.push(...body)
      else if (body) tradeEvents.push(body)
      return send(res, 201, body)
    }
    return send(res, 200, tradeEvents)
  }

  if (path === '/rest/v1/accounts') {
    accountQueries++

    if (req.method === 'GET') {
      const filter = url.searchParams.get('account_id') // "eq.X" or "in.(a,b,c)"
      const wantsSingleObject = (req.headers.accept ?? '').includes('pgrst.object')

      if (filter?.startsWith('in.')) {
        const ids = filter.slice(3).replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))
        return send(res, 200, ids.map((id) => accounts.get(id)).filter(Boolean))
      }
      if (filter?.startsWith('eq.')) {
        const row = accounts.get(filter.slice(3))
        if (wantsSingleObject) {
          // PostgREST returns 406 for .single() with no match.
          return row ? send(res, 200, row) : send(res, 406, { message: 'no rows' })
        }
        return send(res, 200, row ? [row] : [])
      }

      let rows = [...accounts.values()]
      // Honour ?last_update=gte.<iso>, used by /api/data's staleness cutoff.
      const lu = url.searchParams.get('last_update')
      if (lu?.startsWith('gte.')) {
        const cutoff = new Date(lu.slice(4)).getTime()
        rows = rows.filter((r) => new Date(r.last_update).getTime() >= cutoff)
      }
      return send(res, 200, rows)
    }

    if (req.method === 'POST') { // upsert
      const body = await readBody(req)
      const rows = Array.isArray(body) ? body : [body]
      for (const row of rows) {
        if (failUpserts.has(row.account_id)) {
          return send(res, 400, { message: `simulated upsert failure for ${row.account_id}`, code: '23505' })
        }
      }
      for (const row of rows) accounts.set(row.account_id, { ...accounts.get(row.account_id), ...row })
      return send(res, 201, rows)
    }

    if (req.method === 'PATCH') { // .update()
      const body = await readBody(req)
      const filter = url.searchParams.get('account_id') ?? ''
      const ids = filter.startsWith('in.')
        ? filter.slice(3).replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))
        : filter.startsWith('eq.') ? [filter.slice(3)] : [...accounts.keys()]
      for (const id of ids) {
        const row = accounts.get(id)
        if (row) accounts.set(id, { ...row, ...body })
      }
      return send(res, 200, [])
    }
  }

  send(res, 404, { message: `mock supabase: unhandled ${req.method} ${path}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-supabase] listening on ${PORT}`)
})
