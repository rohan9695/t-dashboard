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

describe('a liquidated account', () => {
  test('a zero equity NT8 sent is kept, not back-filled from net_liq', () => {
    // enrichAccount used `if (row.total_available) … else if (row.net_liq)`, a
    // truthy test that cannot tell "equity is zero" from "equity was never
    // set". A blown account reports 0, fell into the else-branch, and had its
    // previous balance copied straight back over the top.
    const row = settled('APEX1', 0, { net_liq: 49800 })
    enrichAccount(row)
    assert.equal(row.total_available, 0, 'the zero survives')
    assert.equal(row.net_liq, 0, 'and the alias follows it down')
  })

  test('but a row that never reported equity still back-fills from net_liq', () => {
    // The case the truthy test was there for — a legacy row carrying only the
    // alias must still populate total_available.
    const row = settled('APEX1', 0, { net_liq: 49800, nt_fields: [] })
    enrichAccount(row)
    assert.equal(row.total_available, 49800)
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

describe('realized P&L sources', () => {
  test('net RealizedProfitLoss beats gross regardless of arrival order', () => {
    for (const order of [
      { GrossRealizedProfitLoss: 120, RealizedProfitLoss: 98 },
      { RealizedProfitLoss: 98, GrossRealizedProfitLoss: 120 },
    ]) {
      const field = {}
      const applied = {}
      for (const [item, value] of Object.entries(order)) {
        const f = ITEM_MAP[item]
        const p = ITEM_PRIORITY[item] ?? 0
        if (f in applied && applied[f] > p) continue
        applied[f] = p
        field[f] = value
      }
      assert.equal(field.realized_pnl, 98, `net wins for ${JSON.stringify(order)}`)
    }
  })

  test('gross is used when the net figure never arrives', () => {
    // The whole point: a connection that only sends the gross figure must show
    // a number, not the $0.00 the daily rollover would otherwise leave behind.
    assert.equal(ITEM_MAP.GrossRealizedProfitLoss, 'realized_pnl')
    assert.ok((ITEM_PRIORITY.GrossRealizedProfitLoss ?? 0) < (ITEM_PRIORITY.RealizedProfitLoss ?? 0))
  })
})

// ── staleness thresholds ────────────────────────────────────────────────────
// Imported from the component because the whole point is that ONE definition
// drives the dots, the offline banner and everything else. A copy here would
// pass while the app used a different number.
const { inTrade, staleThresholdMs, offlineThresholdMs } =
  await import('../../lib/freshness.ts')

describe('how old is too old depends on whether money is at risk', () => {
  test('a flat account tolerates a long quiet spell', () => {
    const flat = { dollar_open: 0, unrealized_pnl: 0 }
    assert.equal(inTrade(flat), false)
    assert.equal(staleThresholdMs(flat), 10 * 60_000, 'NT8 says nothing between trades')
    assert.equal(offlineThresholdMs(flat), 30 * 60_000)
  })

  test('an open position tightens it by orders of magnitude', () => {
    // The case this exists for: MNQ at $2/point, a 4-minute-old figure was
    // $86 wrong on one contract and still rendered green.
    const open = { dollar_open: -86, unrealized_pnl: -86 }
    assert.equal(inTrade(open), true)
    assert.ok(staleThresholdMs(open) <= 30_000, 'must flag within seconds, not minutes')
    assert.ok(offlineThresholdMs(open) < 2 * 60_000)
  })

  test('a short position counts as in-trade too', () => {
    assert.equal(inTrade({ dollar_open: 91.5 }), true)
    assert.equal(inTrade({ dollar_open: -91.5 }), true)
  })

  test('either P&L field alone is enough', () => {
    // dollar_open and unrealized_pnl are kept in sync by buildRow, but a row
    // read straight from the database may carry only one.
    assert.equal(inTrade({ unrealized_pnl: -12 }), true)
    assert.equal(inTrade({ dollar_open: -12 }), true)
    assert.equal(inTrade({}), false, 'missing fields must not read as in-trade')
  })

  test('in-trade is always stricter than flat, never the reverse', () => {
    const flat = { dollar_open: 0 }, open = { dollar_open: 1 }
    assert.ok(staleThresholdMs(open) < staleThresholdMs(flat))
    assert.ok(offlineThresholdMs(open) < offlineThresholdMs(flat))
    // A dot cannot go grey before it goes amber.
    assert.ok(staleThresholdMs(open) < offlineThresholdMs(open))
    assert.ok(staleThresholdMs(flat) < offlineThresholdMs(flat))
  })
})

describe('a balance below the smallest bucket', () => {
  test('a drawn-down 25K account is not relabelled a 50K account', () => {
    // Falling off the end of the table returned a 50K profile, so a 25K
    // account at 19,999 had its trailing allowance doubled (1,000 -> 2,000)
    // and its safety_net_floor moved 25,100 -> 50,100, which uncaps the
    // threshold. A hard drawdown is exactly when the risk numbers must not
    // start describing a different account.
    const p = detectAccountProfile(19999, 'APEX3480290000095')
    assert.equal(p.starting_balance, 25000)
    assert.equal(p.trailing_max, 1000)
    assert.equal(p.safety_net_floor, 25100)
  })

  test('and the PAAPEX/LFE table keeps its own smaller bucket', () => {
    const p = detectAccountProfile(19999, 'PAAPEX3480290000007')
    assert.equal(p.starting_balance, 25000)
    assert.equal(p.trailing_max, 1500, 'PAAPEX 25K carries 1,500, not the APEX 1,000')
  })
})
