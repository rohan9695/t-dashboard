// test/unit/account-groups.test.mjs
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupOf, dayPnl, summarize, sortByPnl, shortId, foldGroups, formatSigned, formatBalance } from '../../lib/account-groups.ts'

describe('groupOf', () => {
  test('PA, Apex and Lucid prefixes land in their own groups', () => {
    assert.equal(groupOf('PAAPEX3480290000007').key, 'PA')
    assert.equal(groupOf('APEX34802900000095').key, 'APEX')
    assert.equal(groupOf('LFE05068171260003').key, 'LUCID')
    assert.equal(groupOf('LFF02590006740001').key, 'LUCID')
  })

  test('PAAPEX never falls into the Apex group', () => {
    assert.notEqual(groupOf('PAAPEX3480290000007').key, groupOf('APEX3480290000089').key)
  })

  test('an unknown prefix gets its own group instead of vanishing', () => {
    const g = groupOf('TPT12345')
    assert.equal(g.key, 'TPT')
    assert.equal(g.order, 99)
  })

  test('matching is case-insensitive', () => {
    assert.equal(groupOf('apex123').key, 'APEX')
  })
})

describe('dayPnl', () => {
  test('matches the main dashboard formula: realized + (unrealized || dollar_open)', () => {
    assert.equal(dayPnl({ realized_pnl: 10, unrealized_pnl: 5, dollar_open: 99 }), 15)
    assert.equal(dayPnl({ realized_pnl: 10, unrealized_pnl: 0, dollar_open: 7 }), 17)
    assert.equal(dayPnl({}), 0)
  })
})

describe('summarize', () => {
  const rows = [
    { account_id: 'APEX1', realized_pnl: 100, total_available: 25000 },
    { account_id: 'APEX2', realized_pnl: -40, total_available: 25000 },
    { account_id: 'PAAPEX1', realized_pnl: 6.44, total_available: 50000 },
    { account_id: 'LFE1', unrealized_pnl: 12, total_available: 25000 },
  ]

  test('sums per group and orders PA, Apex, Lucid', () => {
    const s = summarize(rows)
    assert.deepEqual(s.map((g) => g.group.key), ['PA', 'APEX', 'LUCID'])
    assert.equal(s[1].pnl, 60)
    assert.equal(s[1].rows.length, 2)
    assert.equal(s[1].balance, 50000)
  })

  test('group totals add up to the overall total — nothing is dropped', () => {
    const grand = summarize(rows).reduce((t, g) => t + g.pnl, 0)
    const direct = rows.reduce((t, r) => t + dayPnl(r), 0)
    assert.equal(grand, direct)
    assert.equal(summarize(rows).reduce((n, g) => n + g.rows.length, 0), rows.length)
  })
})

describe('summarize — detail', () => {
  const rows = [
    { account_id: 'APEX0001', realized_pnl: 100, total_available: 1 },
    { account_id: 'APEX0002', realized_pnl: -40, unrealized_pnl: 10, total_available: 1 },
    { account_id: 'APEX0003', total_available: 1 },
    { account_id: 'PAAPEX0001', realized_pnl: 5, total_available: 1 },
  ]

  test('splits realized from open and counts up / down / flat', () => {
    const apex = summarize(rows).find((g) => g.group.key === 'APEX')
    assert.equal(apex.realized, 60)
    assert.equal(apex.open, 10)
    assert.equal(apex.pnl, 70)
    assert.deepEqual([apex.up, apex.down, apex.flat], [1, 1, 1])
  })

  test('realized + open always equals the group P&L', () => {
    for (const g of summarize(rows)) assert.equal(g.realized + g.open, g.pnl)
  })

  test('finds the best and worst account', () => {
    const apex = summarize(rows).find((g) => g.group.key === 'APEX')
    assert.deepEqual(apex.best, { account_id: 'APEX0001', pnl: 100 })
    assert.deepEqual(apex.worst, { account_id: 'APEX0002', pnl: -30 })
  })

  test('counts only accounts still reporting', () => {
    const apex = summarize(rows, (r) => r.account_id === 'APEX0003').find((g) => g.group.key === 'APEX')
    assert.equal(apex.reporting, 2)
    assert.equal(apex.rows.length, 3)
  })

  test('sortByPnl orders best first without changing the totals', () => {
    const sorted = sortByPnl(summarize(rows))
    assert.deepEqual(sorted.map((g) => g.group.key), ['APEX', 'PA'])
    assert.equal(sorted.reduce((t, g) => t + g.pnl, 0), 75)
  })

  test('shortId keeps the last four characters', () => {
    assert.equal(shortId('APEX3480290000089'), '…0089')
    assert.equal(shortId('SIM'), 'SIM')
  })
})

describe('share image helpers', () => {
  const g = (n, pnl) => ({ label: `G${n}`, count: n, pnl })

  test('foldGroups leaves a short list alone', () => {
    const groups = [g(1, 10), g(2, -5)]
    assert.deepEqual(foldGroups(groups), groups)
  })

  test('foldGroups folds the overflow into one row without losing money or accounts', () => {
    const groups = Array.from({ length: 9 }, (_, i) => g(i + 1, (i + 1) * 10))
    const folded = foldGroups(groups, 6)
    assert.equal(folded.length, 6)
    assert.equal(folded[5].label, '+ 4 more groups')
    assert.equal(folded.reduce((s, r) => s + r.pnl, 0), groups.reduce((s, r) => s + r.pnl, 0))
    assert.equal(folded.reduce((s, r) => s + r.count, 0), groups.reduce((s, r) => s + r.count, 0))
  })

  test('formatters sign and round the way the dashboard does', () => {
    assert.equal(formatSigned(1234.5), '+$1,234.50')
    assert.equal(formatSigned(-12), '-$12.00')
    assert.equal(formatSigned(0), '+$0.00')
    assert.equal(formatBalance(25274.38), '$25,274')
    assert.equal(formatBalance(-1500), '-$1,500')
  })
})
