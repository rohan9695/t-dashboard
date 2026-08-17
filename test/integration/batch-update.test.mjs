// test/integration/batch-update.test.mjs
// Drives the real /api/batch-update route against the mock database.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  account, resetAll, seed, storedAccounts, postJson,
  resetQueries, queryCount, failUpsertFor,
} from '../helpers.mjs'

const FIVE = ['PAAPEX3480290000007', 'APEX3480290000089', 'APEX3480290000090', 'APEX3480290000091', 'APEX3480290000092']

beforeEach(resetAll)

describe('/api/batch-update', () => {
  test('CashValue cannot freeze equity while a position is open', async () => {
    await seed(account('APEX1', 50000))
    // Both arrive in one batch, CashValue last. Pre-fix this stored 50000 and
    // the dashboard showed a full drawdown buffer on a losing account.
    const res = await postJson('/api/batch-update', { APEX1: { NetLiquidation: 49247.14, CashValue: 50000 }, _ts: 2000 })
    assert.equal(res.status, 200)

    const [row] = await storedAccounts()
    assert.equal(row.total_available, 49247.14)
    assert.equal(Math.round(row.dist_drawdown * 100) / 100, 1247.14, 'risk buffer reflects real equity')
  })

  test('open P&L reaches the dashboard fields', async () => {
    await seed(account('APEX1', 50000))
    await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50312.5, UnrealizedProfitLoss: 312.5 }, _ts: 2000 })
    const [row] = await storedAccounts()
    assert.equal(row.unrealized_pnl, 312.5)
    assert.equal(row.dollar_open, 312.5)
  })

  test('an older batch never clobbers newer stored data', async () => {
    await seed(account('APEX1', 50000, { last_batch_ts: 9000 }))
    await postJson('/api/batch-update', { APEX1: { NetLiquidation: 99999 }, _ts: 8000 })
    const [row] = await storedAccounts()
    assert.equal(row.total_available, 50000)
  })

  test('a live account is always un-hidden (incident 2026-07-14)', async () => {
    await seed(account('APEX1', 50000, { hidden: true }))
    await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50750.25 }, _ts: 2000 })
    const [row] = await storedAccounts()
    assert.equal(row.hidden, false)
  })

  test('a clock that ran ahead does not freeze ingestion forever', async () => {
    // last_batch_ts is the NT8 MACHINE clock, not the server's. If that clock
    // is briefly ahead — or corrects backwards after an NTP sync — the stored
    // value sits in the future and every later batch is refused. Silently:
    // HTTP 200, processed:0, nothing logged anywhere the trader can see. The
    // dashboard freezes and every other indicator still reads healthy.
    const oneHourAhead = Date.now() + 60 * 60_000
    await seed(account('APEX1', 50000, { last_batch_ts: oneHourAhead }))

    const res = await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50750.25 }, _ts: Date.now() })
    assert.equal(res.status, 200)

    const [row] = await storedAccounts()
    assert.equal(row.total_available, 50750.25, 'a corrected clock must not lock the account out')
  })

  test('item names the dashboard does not understand are named in the reply', async () => {
    // Unmapped items were dropped without a trace, which is how a gross-only
    // realized P&L feed went unnoticed: the value arrived every second and
    // vanished on arrival. Naming them costs nothing and makes one curl enough
    // to see what NT8 is really sending.
    await seed(account('APEX1', 50000))
    const res = await postJson('/api/batch-update', {
      APEX1: { NetLiquidation: 50100, SomeUnmappedApexField: 42 }, _ts: 2000,
    })
    const body = await res.json()
    assert.deepEqual(body.unknown, ['SomeUnmappedApexField'])
  })

  test('a gross-only P&L feed still shows realized P&L', async () => {
    // day_date in the past forces the daily-rollover branch, which is exactly
    // where a realized_pnl NT8 does not own gets zeroed for the whole session.
    await seed(account('APEX1', 50000, { nt_fields: ['total_available'], realized_pnl: 0, day_date: '01/01/2020' }))
    await postJson('/api/batch-update', {
      APEX1: { NetLiquidation: 50088.64, GrossRealizedProfitLoss: 88.64 }, _ts: 2000,
    })
    const [row] = await storedAccounts()
    assert.equal(row.realized_pnl, 88.64, 'gross is better than a permanent $0.00')
  })

  test('the net P&L figure still wins when both arrive', async () => {
    await seed(account('APEX1', 50000))
    await postJson('/api/batch-update', {
      APEX1: { GrossRealizedProfitLoss: 120, RealizedProfitLoss: 98 }, _ts: 2000,
    })
    const [row] = await storedAccounts()
    assert.equal(row.realized_pnl, 98, 'net beats gross regardless of payload order')
  })

  test('underscore-prefixed keys are metadata, not accounts', async () => {
    // Without this, _replikanto is taken for an account id and its string value
    // is iterated character by character into a garbage row — which is what
    // would have happened the moment the addon started sending copier status.
    await postJson('/api/batch-update', {
      APEX1: { NetLiquidation: 50100 },
      _ts: 2000,
      _replikanto: 'online',
      _replikanto_followers: 3,
    })
    const rows = await storedAccounts()
    assert.deepEqual(rows.map((r) => r.account_id), ['APEX1'], 'only the real account is written')
  })

  test('_replikanto is stored as replikanto_status on every account in the batch', async () => {
    await postJson('/api/batch-update', {
      APEX1: { NetLiquidation: 50100 },
      APEX2: { NetLiquidation: 25000 },
      _ts: 2000,
      _replikanto: 'off',
    })
    const rows = await storedAccounts()
    assert.ok(rows.every((r) => r.replikanto_status === 'off'), 'one link status, broadcast to every row')
  })

  test('a batch without _replikanto never blanks a previously-known status', async () => {
    await seed(account('APEX1', 50000, { replikanto_status: 'online' }))
    await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50750.25 }, _ts: 2000 })
    const [row] = await storedAccounts()
    assert.equal(row.replikanto_status, 'online', 'an older addon build must not erase the last known status')
  })

  test('a new day clears P&L NT8 is no longer sending', async () => {
    // Monday morning, Friday's realized P&L still on the row, and NT8 sending
    // only NetLiquidation because there has been no fill yet. nt_fields still
    // lists realized_pnl from Friday, and it is append-only — so the rollover
    // used to treat the field as NT8-owned forever and never clear it. Friday's
    // figure sat there looking live, because the balance beside it kept
    // updating.
    await seed(account('APEX1', 50603.24, {
      nt_fields: ['total_available', 'realized_pnl'],
      realized_pnl: 121.84, day_date: '01/01/2020',
    }))
    await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50603.24 }, _ts: 2000 })
    const [row] = await storedAccounts()
    assert.equal(row.realized_pnl, 0, "yesterday's realized P&L must not survive the rollover")
  })

  test('but a value NT8 sends in the same batch survives the rollover', async () => {
    // The case the old guard existed for, and it still has to hold: zeroing a
    // figure that arrived in this very batch would blank a live number.
    await seed(account('APEX1', 50000, {
      nt_fields: ['total_available', 'realized_pnl'],
      realized_pnl: 121.84, day_date: '01/01/2020',
    }))
    await postJson('/api/batch-update', {
      APEX1: { NetLiquidation: 50250, RealizedProfitLoss: 250 }, _ts: 2000,
    })
    const [row] = await storedAccounts()
    assert.equal(row.realized_pnl, 250, 'a figure sent this batch is live, not carried over')
  })

  test('sim accounts are ignored', async () => {
    await seed(account('APEXREAL', 50000))
    await postJson('/api/batch-update', { APEXREAL: { NetLiquidation: 50500 }, Sim101: { NetLiquidation: 99980 }, _ts: 2000 })
    const rows = await storedAccounts()
    assert.equal(rows.some((r) => r.account_id === 'Sim101'), false)
  })

  test('a wrong API key is rejected', async () => {
    const res = await postJson('/api/batch-update', { APEX1: { NetLiquidation: 1 } }, 'wrong-key')
    assert.equal(res.status, 401)
  })

  test('a failed write is reported, not silently swallowed', async () => {
    await seed(account('APEX1', 50000))
    await failUpsertFor('APEX1')
    const res = await postJson('/api/batch-update', { APEX1: { NetLiquidation: 50750 }, _ts: 2000 })
    assert.equal(res.status, 500)
    assert.equal((await res.json()).status, 'partial')
  })
})

describe('/api/batch-update — cost does not grow with account count', () => {
  for (const n of [1, 5, 20, 50]) {
    test(`${n} accounts costs exactly 2 queries`, async () => {
      await resetAll()
      const payload = { _ts: 2000 }
      for (let i = 0; i < n; i++) {
        const id = `APEX${String(i).padStart(4, '0')}`
        await seed(account(id, 50000))
        payload[id] = { NetLiquidation: 50000 + i, CashValue: 49000 }
      }
      await resetQueries()

      const res = await postJson('/api/batch-update', payload)
      assert.equal((await res.json()).processed, n)
      assert.equal(await queryCount(), 2, 'one read + one write, whatever the account count')
      assert.equal((await storedAccounts()).length, n)
    })
  }

  test('correctness holds at 20 accounts', async () => {
    const payload = { _ts: 2000 }
    for (let i = 0; i < 20; i++) {
      const id = `APEX${String(i).padStart(4, '0')}`
      await seed(account(id, 50000))
      payload[id] = { NetLiquidation: 50000 + i, CashValue: 49000 }
    }
    await postJson('/api/batch-update', payload)
    const rows = await storedAccounts()
    assert.equal(rows.find((r) => r.account_id === 'APEX0000').total_available, 50000)
    assert.equal(rows.find((r) => r.account_id === 'APEX0019').total_available, 50019)
  })

  test('the staleness guard still applies per account inside a bulk write', async () => {
    await seed(account('APEXFRESH', 50000, { last_batch_ts: 9000 }))
    await seed(account('APEXOLD', 50000, { last_batch_ts: 1000 }))
    await postJson('/api/batch-update', { APEXFRESH: { NetLiquidation: 99999 }, APEXOLD: { NetLiquidation: 51111 }, _ts: 5000 })
    const rows = await storedAccounts()
    assert.equal(rows.find((r) => r.account_id === 'APEXFRESH').total_available, 50000)
    assert.equal(rows.find((r) => r.account_id === 'APEXOLD').total_available, 51111)
  })
})
