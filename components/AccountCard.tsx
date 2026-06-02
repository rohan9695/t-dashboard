'use client'

import { DANGER_THRESHOLD, CAUTION_THRESHOLD, type AccountRow } from '@/lib/trading-logic'

export function fmt(n: number) {
  const v = n || 0
  const sign = v < 0 ? '-' : ''
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtBalance(n: number) {
  const v = Math.round(n || 0)
  const sign = v < 0 ? '-' : ''
  return sign + '$' + Math.abs(v).toLocaleString('en-US')
}

export function distColor(v: number) {
  if (v <= DANGER_THRESHOLD)  return 'text-red-400'
  if (v <= CAUTION_THRESHOLD) return 'text-amber-400'
  return 'text-emerald-400'
}

export function pnlColor(v: number) {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-zinc-400'
}

export function secondsAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 120) return '1m ago'
  return `${Math.floor(s / 60)}m ago`
}

export function AccountRow({ row, isBest }: { row: AccountRow; isBest: boolean }) {
  const {
    account_id,
    dollar_open,
    dist_to_daily_loss,
    drawdown_auto,
    total_available,
    trailing_max,
    dist_drawdown,
    realized_pnl,
    unrealized_pnl,
    last_update,
    status,
  } = row

  const dayPnl = (realized_pnl || 0) + (unrealized_pnl || dollar_open || 0)
  const totalPnl = dayPnl
  const isBreached = status === 'breached'
  const isStale    = status === 'stale'

  const rowBg = isBreached
    ? 'bg-red-950/30'
    : isStale
      ? 'bg-zinc-900/40 opacity-60'
      : 'bg-zinc-900 hover:bg-zinc-800/60'

  return (
    <tr className={`border-b border-zinc-800 transition-colors ${rowBg}`}>
      {/* Status dot */}
      <td className="px-3 py-3 w-8">
        <span className={[
          'inline-block w-2.5 h-2.5 rounded-full',
          isBreached ? 'bg-red-500' : isStale ? 'bg-zinc-600' : 'bg-emerald-400',
        ].join(' ')} />
      </td>

      {/* Account ID */}
      <td className="px-3 py-3 min-w-[160px]">
        <div className="flex items-center gap-1.5">
          {isBest && <span title="Best day P&L" className="text-sm">👑</span>}
          <span className="text-xs font-mono font-semibold text-zinc-100 break-all">{account_id}</span>
        </div>
        <span className="text-[9px] text-zinc-600">{secondsAgo(last_update)}</span>
      </td>

      {/* Cash Value / Total Available */}
      <td className="px-3 py-3 text-right font-mono text-sm text-zinc-100">{fmtBalance(total_available)}</td>

      {/* Dist Daily Loss */}
      <td className={`px-3 py-3 text-right font-mono text-sm ${distColor(dist_to_daily_loss)}`}>{fmt(dist_to_daily_loss)}</td>

      {/* Drawdown Auto */}
      <td className="px-3 py-3 text-right font-mono text-sm text-zinc-300">{fmt(drawdown_auto)}</td>

      {/* Trailing Max */}
      <td className="px-3 py-3 text-right font-mono text-sm text-zinc-300">{fmt(trailing_max)}</td>

      {/* Dist Drawdown */}
      <td className={`px-3 py-3 text-right font-mono text-sm ${distColor(dist_drawdown)}`}>{fmt(dist_drawdown)}</td>

      {/* Dollar Open / Unrealized */}
      <td className={`px-3 py-3 text-right font-mono text-sm ${pnlColor(dollar_open)}`}>{fmt(dollar_open)}</td>

      {/* Realized P&L */}
      <td className={`px-3 py-3 text-right font-mono text-sm ${pnlColor(realized_pnl)}`}>{fmt(realized_pnl)}</td>

      {/* Unrealized P&L */}
      <td className={`px-3 py-3 text-right font-mono text-sm ${pnlColor(unrealized_pnl)}`}>{fmt(unrealized_pnl)}</td>

      {/* Day P&L */}
      <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${pnlColor(dayPnl)}`}>{fmt(dayPnl)}</td>

      {/* Drawdown gauge */}
      <td className="px-3 py-3 w-24">
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={[
                'h-full rounded-full transition-all duration-700',
                dist_drawdown <= DANGER_THRESHOLD ? 'bg-red-500' : dist_drawdown <= CAUTION_THRESHOLD ? 'bg-amber-500' : 'bg-emerald-500',
              ].join(' ')}
              style={{ width: `${trailing_max > 0 ? Math.min(100, Math.max(0, (dist_drawdown / trailing_max) * 100)) : 0}%` }}
            />
          </div>
          <span className="text-[9px] text-zinc-600 font-mono text-right">
            {trailing_max > 0 ? ((dist_drawdown / trailing_max) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </td>
    </tr>
  )
}

// Keep AccountCard as alias for backward compat
export function AccountCard({ row, isBest }: { row: AccountRow; isBest: boolean }) {
  return <AccountRow row={row} isBest={isBest} />
}
