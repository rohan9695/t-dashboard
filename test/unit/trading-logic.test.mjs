// test/unit/trading-logic.test.mjs
// Pure logic — no server, no database, no build step. Node imports the
// TypeScript source directly, so these run in milliseconds and test exactly
// what ships.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ITEM_MAP,
  ITEM_PRIORITY,
  emptyAccount,
  enrichAccount,
  computeTradovateMetrics,
  detectAccountProfile,
} from '../../lib/trading-logic.ts'

const today = () =>
  new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  })

/** Applies a batch of NT8 items exactly as the ingestion routes do. */
function applyItems(row, items) {
  const applied = {}
  for (const [name, value] of Object.entries(items)) {
    const field = ITEM_MAP[name]
    if (!field) continue
    const priority = ITEM_PRIORITY[name] ?? 0
    if (field in applied && applied[field] > priority) continue
    applied[field] = priority
    row[field] = value
    if (field === 'dollar_open') row.unrealized_pnl = value
    if (field === 'unrealized_pnl') row.dollar_open = value
    if (!row.nt_fields.includes(field)) row.nt_fields = [...row.nt_fields, field]
  }
  return row
}

const settled = (id, balance, over = {}) => ({
  ...emptyAccount(),
  account_id: id,
  total_available: balance,
  drawdown_auto: 48000,
  trailing_max: 2000,
  peak_balance: 50000,
  day_start_balance: 50000,
  day_date: today(),
  nt_fields: ['total_available'],
  ...over,
})

describe('ITEM_PRIORITY — which NT8 item wins for total_available', () => {
  test('NetLiquidation beats CashValue even when CashValue arrives last', () => {
    // The bug this exists for: CashValue does not move while a position is
    // open, so letting it win pins equity to a flat number mid-trade.
    const row = applyItems(settled('A', 50000), { NetLiquidation: 50750.25, CashValue: 50000 })
    assert.equal(row.total_available, 50750.25)
  })

  test('NetLiquidation beats CashValue in either payload order', () => {
    const row = applyItems(settled('A', 50000), { CashValue: 50000, NetLiquidation: 50750.25 })
    assert.equal(row.total_available, 50750.25)
  })

  test('TotalAvailable beats CashValue but loses to NetLiquidation', () => {
    assert.equal(applyItems(settled('A', 0), { CashValue: 1, TotalAvailable: 2 }).total_available, 2)
    assert.equal(applyItems(settled('A', 0), { TotalAvailable: 2, NetLiquidation: 3 }).total_available, 3)
  })

  test('CashValue alone still applies — priority never blocks a lone source', () => {
    assert.equal(applyItems(settled('A', 0), { CashValue: 49999 }).total_available, 49999)
  })

  test('equal-priority aliases keep last-wins', () => {
    assert.equal(applyItems(settled('A', 0), { DollarOpen: 100, OpenPnL: 250 }).dollar_open, 250)
  })
})

describe('open P&L', () => {
  test('UnrealizedProfitLoss mirrors into dollar_open', () => {
    const row = applyItems(settled('A', 50000), { UnrealizedProfitLoss: 312.5 })
    assert.equal(row.unrealized_pnl, 312.5)
    assert.equal(row.dollar_open, 312.5)
  })

  test('a zero clears both — a closed position must not leave a stale value', () => {
    const row = applyItems(
      settled('A', 50000, { unrealized_pnl: 312.5, dollar_open: 312.5, nt_fields: ['total_available', 'unrealized_pnl'] }),
      { UnrealizedProfitLoss: 0 },
    )
    assert.equal(row.unrealized_pnl, 0)
    assert.equal(row.dollar_open, 0)
  })

  test('a losing position survives as a negative', () => {
    assert.equal(applyItems(settled('A', 50000), { UnrealizedProfitLoss: -800 }).unrealized_pnl, -800)
  })
})

describe('account profiles', () => {
  test('PAAPEX and LFE 50K carry a $2,500 trailing drawdown, not $2,000', () => {
    assert.equal(detectAccountProfile(50000, 'PAAPEX3480290000007').trailing_max, 2500)
    assert.equal(detectAccountProfile(50000, 'LFE123').trailing_max, 2500)
    assert.equal(detectAccountProfile(50000, 'APEX3480290000089').trailing_max, 2000)
  })

  test('size is detected from balance', () => {
    assert.equal(detectAccountProfile(150000, 'APEX1').starting_balance, 150000)
    assert.equal(detectAccountProfile(100000, 'APEX1').starting_balance, 100000)
    assert.equal(detectAccountProfile(50000, 'APEX1').starting_balance, 50000)
    assert.equal(detectAccountProfile(25000, 'APEX1').starting_balance, 25000)
  })
})

describe('risk fields — NT8 is the source of truth', () => {
  test('a value NT8 reported is shown as sent, not recomputed', () => {
    const row = settled('APEX1', 49247.14, { nt_fields: ['total_available', 'dist_drawdown'], dist_drawdown: 1834.22 })
    enrichAccount(row, true)
    assert.equal(row.dist_drawdown, 1834.22, 'NT8 value must survive enrichment')
  })

  test('a field NT8 never sent falls back to the profile calculation', () => {
    const row = settled('APEX1', 49247.14)
    enrichAccount(row, true)
    assert.equal(row.drawdown_auto, 48000)
    assert.equal(Math.round(row.dist_drawdown * 100) / 100, 1247.14)
  })

  test('a new equity high trails the threshold up, capping the buffer', () => {
    const row = settled('APEX1', 50750.25)
    enrichAccount(row, true)
    assert.equal(row.drawdown_auto, 48750.25)
    assert.equal(row.dist_drawdown, 2000, 'buffer caps at trailing_max on a new high')
  })

  test('daily loss remaining is computed from the day-start balance', () => {
    const row = settled('APEX1', 49247.14)
    enrichAccount(row, true)
    assert.equal(Math.round(row.dist_to_daily_loss * 100) / 100, 247.14)
  })

  test('an account below zero equity is left alone', () => {
    const row = settled('APEX1', 0)
    const before = { ...row }
    computeTradovateMetrics(row, true)
    assert.equal(row.dist_drawdown, before.dist_drawdown)
  })
})

describe('daily rollover', () => {
  test('a new session clears P&L the app owns', () => {
    const row = settled('APEX1', 50000, { day_date: '01/01/2020', realized_pnl: 500, unrealized_pnl: 300, dollar_open: 300 })
    computeTradovateMetrics(row, true)
    assert.equal(row.realized_pnl, 0)
    assert.equal(row.unrealized_pnl, 0)
    assert.equal(row.day_date, today())
  })

  test('but never blanks a figure NT8 is reporting', () => {
    // NT8 rolls its own P&L at the session boundary; zeroing a value it just
    // sent would leave a live number at zero for the rest of the day.
    const row = settled('APEX1', 50000, {
      day_date: '01/01/2020',
      realized_pnl: 240.26,
      nt_fields: ['total_available', 'realized_pnl'],
    })
    computeTradovateMetrics(row, true)
    assert.equal(row.realized_pnl, 240.26)
  })
})

describe('emptyAccount', () => {
  test('starts visible and at batch zero, so a first update always applies', () => {
    const row = emptyAccount()
    assert.equal(row.hidden, false)
    assert.equal(row.last_batch_ts, 0)
    assert.deepEqual(row.nt_fields, [])
  })
})
