// lib/account-groups.ts
// Pure helpers for the read-only grouped summary page (/summary). Nothing here
// is imported by the main dashboard, the API routes or the edge functions.

export interface AccountGroup {
  key: string
  label: string
  /** Sort position of the group on the page. Unrecognised prefixes sort last. */
  order: number
}

const PA: AccountGroup    = { key: 'PA',    label: 'PA Accounts',    order: 0 }
const APEX: AccountGroup  = { key: 'APEX',  label: 'Apex Accounts',  order: 1 }
const LUCID: AccountGroup = { key: 'LUCID', label: 'Lucid Accounts', order: 2 }

/**
 * Which group an account belongs to, from its NT8 account name.
 *
 * Unknown prefixes get a group of their own (named after their leading letters)
 * rather than being dropped — an account that silently vanishes from a P&L
 * total is worse than one that shows up under an unfamiliar heading.
 */
export function groupOf(accountId: string): AccountGroup {
  const id = (accountId || '').toUpperCase()
  if (id.startsWith('PAAPEX')) return PA
  if (id.startsWith('APEX')) return APEX
  // Lucid accounts have been seen as both LFE… and LFF…
  if (id.startsWith('LFE') || id.startsWith('LFF')) return LUCID
  const letters = /^[A-Z]+/.exec(id)?.[0] ?? 'OTHER'
  return { key: letters, label: `${letters} Accounts`, order: 99 }
}

export interface PnlRow {
  realized_pnl?: number | null
  unrealized_pnl?: number | null
  dollar_open?: number | null
}

/**
 * Day P&L for one account — deliberately the same formula the main dashboard
 * uses for its TOTAL P&L column and Total Profit card, so the two pages can
 * never show different numbers for the same account.
 */
export function dayPnl(row: PnlRow): number {
  return (row.realized_pnl || 0) + (row.unrealized_pnl || row.dollar_open || 0)
}

/** The open-position part of dayPnl. */
export function openPnl(row: PnlRow): number {
  return row.unrealized_pnl || row.dollar_open || 0
}

export interface Extreme { account_id: string; pnl: number }

export interface GroupSummary<T> {
  group: AccountGroup
  rows: T[]
  pnl: number
  realized: number
  open: number
  balance: number
  up: number
  down: number
  flat: number
  /** Accounts still reporting, i.e. not past the offline threshold. */
  reporting: number
  best: Extreme | null
  worst: Extreme | null
}

type SummaryRow = PnlRow & { account_id: string; total_available?: number | null }

export function summarize<T extends SummaryRow>(
  rows: T[],
  isOffline: (row: T) => boolean = () => false,
): GroupSummary<T>[] {
  const byKey = new Map<string, GroupSummary<T>>()
  for (const row of rows) {
    const group = groupOf(row.account_id)
    let g = byKey.get(group.key)
    if (!g) {
      g = {
        group, rows: [], pnl: 0, realized: 0, open: 0, balance: 0,
        up: 0, down: 0, flat: 0, reporting: 0, best: null, worst: null,
      }
      byKey.set(group.key, g)
    }
    const pnl = dayPnl(row)
    g.rows.push(row)
    g.pnl += pnl
    g.realized += row.realized_pnl || 0
    g.open += openPnl(row)
    g.balance += row.total_available || 0
    if (pnl > 0) g.up++
    else if (pnl < 0) g.down++
    else g.flat++
    if (!isOffline(row)) g.reporting++
    if (!g.best || pnl > g.best.pnl) g.best = { account_id: row.account_id, pnl }
    if (!g.worst || pnl < g.worst.pnl) g.worst = { account_id: row.account_id, pnl }
  }
  return [...byKey.values()].sort(
    (a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label),
  )
}

/** Orders groups by day P&L, best first. Ties keep the fixed PA/Apex/Lucid order. */
export function sortByPnl<T>(groups: GroupSummary<T>[]): GroupSummary<T>[] {
  return [...groups].sort((a, b) => b.pnl - a.pnl || a.group.order - b.group.order)
}

/** "…0089" — enough of an account id to recognise it in a one-line summary. */
export function shortId(accountId: string): string {
  return accountId.length > 4 ? `…${accountId.slice(-4)}` : accountId
}

/** "+$1,234.56" / "-$12.00" — always signed, always two decimals. */
export function formatSigned(n: number): string {
  const v = n || 0
  return (v < 0 ? '-' : '+') + '$' + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** "$25,274" — whole dollars, for balances. */
export function formatBalance(n: number): string {
  const v = Math.round(n || 0)
  return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US')
}

export interface CardGroup { label: string; count: number; pnl: number }

/**
 * Rows for the share image: the first few groups as they are, with everything
 * beyond `max` folded into a single "+ N more groups" line. Totals are
 * preserved so the image never drops money it can't fit.
 */
export function foldGroups(groups: CardGroup[], max = 6): CardGroup[] {
  if (groups.length <= max) return groups
  const shown = groups.slice(0, max - 1)
  const rest = groups.slice(max - 1)
  return [
    ...shown,
    {
      label: `+ ${rest.length} more groups`,
      count: rest.reduce((n, g) => n + g.count, 0),
      pnl: rest.reduce((s, g) => s + g.pnl, 0),
    },
  ]
}
