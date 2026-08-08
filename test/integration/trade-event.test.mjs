// test/integration/trade-event.test.mjs
// Drives the real /api/trade-event route and asserts on exactly what would
// have reached the phone.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetAll, storedTrades, notifications, postJson } from '../helpers.mjs'

const FIVE = ['PAAPEX3480290000007', 'APEX3480290000089', 'APEX3480290000090', 'APEX3480290000091', 'APEX3480290000092']

beforeEach(resetAll)

describe('/api/trade-event — one notification per fill round', () => {
  test('a five-account fill sends ONE alert and writes five rows', async () => {
    await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'long', event_type: 'open', accounts: FIVE, total_accounts: 5, quantity: 1,
    })

    const notes = await notifications()
    assert.equal(notes.length, 1, 'one notification, not one per account')
    assert.equal(notes[0].title, 'ES long')
    assert.equal(notes[0].body, 'Filled on 5 accounts')
    assert.equal(notes[0].priority, 'default')

    assert.equal((await storedTrades()).length, 5, 'dashboard toast still gets a row per account')
  })

  test('a fill that missed accounts is urgent — the reason this exists', async () => {
    await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'long', event_type: 'open', accounts: [FIVE[0]], total_accounts: 5,
    })

    const [note] = await notifications()
    assert.equal(note.title, 'ES long - PARTIAL')
    assert.equal(note.body, 'Filled on 1 of 5 accounts only')
    assert.equal(note.priority, 'urgent', 'must break through a silenced phone')
    assert.equal(note.tags, 'rotating_light')
  })

  test('a winning close reports P&L', async () => {
    await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'flat', event_type: 'close', accounts: FIVE, total_accounts: 5, pnl: 240.26,
    })
    const [note] = await notifications()
    assert.equal(note.title, 'ES closed')
    assert.equal(note.body, '+$240.26 on 5 accounts')
    assert.equal(note.priority, 'default')
  })

  test('a losing close renders one sign, not "+-"', async () => {
    await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'flat', event_type: 'close', accounts: FIVE, pnl: -493.02,
    })
    assert.equal((await notifications())[0].body, '-$493.02 on 5 accounts')
  })

  test('omitting total_accounts raises no false alarm', async () => {
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: FIVE })
    const [note] = await notifications()
    assert.equal(note.priority, 'default')
    assert.equal(note.body, 'Filled on 5 accounts')
  })

  test('sim accounts are excluded from the count and the rows', async () => {
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'long', accounts: [...FIVE, 'Sim101'], total_accounts: 5 })
    assert.equal((await notifications())[0].body, 'Filled on 5 accounts')
    assert.equal((await storedTrades()).some((t) => t.account_id === 'Sim101'), false)
  })

  test('the single-account form is still accepted', async () => {
    await postJson('/api/trade-event', { symbol: 'NQ', direction: 'short', account: FIVE[0], total_accounts: 5 })
    const notes = await notifications()
    assert.equal(notes.length, 1)
    assert.equal(notes[0].title, 'NQ short - PARTIAL')
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

  test('bad input writes nothing and notifies nobody', async () => {
    await postJson('/api/trade-event', { symbol: 'ES', direction: 'sideways', accounts: FIVE })
    assert.equal((await storedTrades()).length, 0)
    assert.equal((await notifications()).length, 0)
  })
})
