// test/integration/trade-event.test.mjs
// Drives the real /api/trade-event route. It writes the trade_events rows the
// dashboard toast subscribes to, and reports enough in the response
// (accounts/expected/partial) for a caller to know whether the round was
// complete — but it does NOT send the ntfy phone push. That moved to
// nt8/AccountMonitor.cs on 2026-08-14 (see route.ts's header comment for why:
// ntfy.sh rate-limits Cloudflare Workers' shared egress IPs regardless of
// authentication). Only one place may own the push, so this suite also guards
// against it quietly coming back here.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetAll, storedTrades, notifications, postJson } from '../helpers.mjs'

const FIVE = ['PAAPEX3480290000007', 'APEX3480290000089', 'APEX3480290000090', 'APEX3480290000091', 'APEX3480290000092']

beforeEach(resetAll)

describe('/api/trade-event — writes rows, reports the round, sends no push', () => {
  test('a five-account fill writes five rows and reports a complete round', async () => {
    const res = await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'long', event_type: 'open', accounts: FIVE, total_accounts: 5, quantity: 1,
    })
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.accounts, 5)
    assert.equal(body.expected, 5)
    assert.equal(body.partial, false)

    assert.equal((await storedTrades()).length, 5, 'dashboard toast still gets a row per account')
  })

  test('a fill that missed accounts reports partial — this is what the addon escalates on', async () => {
    const res = await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'long', event_type: 'open', accounts: [FIVE[0]], total_accounts: 5,
    })
    const body = await res.json()
    assert.equal(body.accounts, 1)
    assert.equal(body.expected, 5)
    assert.equal(body.partial, true)
  })

  test('omitting total_accounts raises no false partial', async () => {
    const body = await (await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: FIVE })).json()
    assert.equal(body.partial, false)
  })

  test('sim accounts are excluded from the count and the rows', async () => {
    const body = await (await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: [...FIVE, 'Sim101'], total_accounts: 5 })).json()
    assert.equal(body.accounts, 5)
    assert.equal((await storedTrades()).some((t) => t.account_id === 'Sim101'), false)
  })

  test('the single-account form is still accepted', async () => {
    const body = await (await postJson('/api/trade-event', { symbol: 'NQ', direction: 'short', account: FIVE[0], total_accounts: 5 })).json()
    assert.equal(body.accounts, 1)
    assert.equal(body.partial, true)
  })

  test('pnl is stored on a close for the trade log, even though nothing pushes it', async () => {
    await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'flat', event_type: 'close', accounts: FIVE, total_accounts: 5, pnl: 240.26,
    })
    const rows = await storedTrades()
    assert.ok(rows.every((r) => r.pnl === 240.26))
  })

  test('this route never calls ntfy — the addon owns the push now', async () => {
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: FIVE, total_accounts: 5 })
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: [FIVE[0]], total_accounts: 5 })
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'flat', event_type: 'close', accounts: FIVE, pnl: -10 })
    assert.equal((await notifications()).length, 0, 'a push from here would double up with the addon')
  })
})

describe('/api/trade-event — validation', () => {
  test('rejects a bad direction before it reaches the database', async () => {
    assert.equal((await postJson('/api/trade-event', { symbol: 'ES', direction: 'sideways', accounts: FIVE })).status, 400)
  })

  test('rejects a bad event_type', async () => {
    assert.equal((await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', event_type: 'wat', accounts: FIVE })).status, 400)
  })

  test('requires a symbol', async () => {
    assert.equal((await postJson('/api/trade-event', { direction: 'long', accounts: FIVE })).status, 400)
  })

  test('rejects a wrong API key', async () => {
    assert.equal((await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: FIVE }, 'wrong')).status, 401)
  })

  test('bad input writes nothing', async () => {
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'sideways', accounts: FIVE })
    assert.equal((await storedTrades()).length, 0)
  })
})
