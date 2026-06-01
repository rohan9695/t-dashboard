'use client'
// components/AccountCard.tsx
// Matches all fields shown in main.py's _DASHBOARD_HTML mobile cards:
//   dollar_open, dist_to_daily_loss, drawdown_auto,
//   total_available, trailing_max, dist_drawdown
// Plus drawdown gauge and danger colouring from DANGER/CAUTION_THRESHOLD

import { DANGER_THRESHOLD, CAUTION_THRESHOLD, type AccountRow } from '@/lib/trading-logic'

function fmt(n: number) {
  const v = n || 0
  const sign = v < 0 ? '-' : ''
  return (
    sign +
    '$' +
    Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

function fmtBalance(n: number) {
  const v = Math.round(n || 0)
  const sign = v < 0 ? '-' : ''
  return sign + '$' + Math.abs(v).toLocaleString('en-US')
}

function distColor(v: number) {
  if (v <= DANGER_THRESHOLD)  return 'text-red-400'
  if (v <= CAUTION_THRESHOLD) return 'text-amber-400'
  return 'text-emerald-400'
}

function pnlColor(v: number) {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-zinc-400'
}

function secondsAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 120) return '1m ago'
  return `${Math.floor(s / 60)}m ago`
}

interface MetricProps {
  label: string
  value: string
  className?: string
}
function Metric({ label, value, className = 'text-zinc-100' }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 leading-tight">
        {label}
      </span>
      <span className={`text-sm font-mono font-semibold ${className}`}>{value}</span>
    </div>
  )
}

export function AccountCard({ row, isBest }: { row: AccountRow; isBest: boolean }) {
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

  // Drawdown gauge — dist_drawdown as % of trailing_max
  const ddPct =
    trailing_max > 0
      ? Math.min(100, Math.max(0, (dist_drawdown / trailing_max) * 100))
      : 0
  const gaugeColor =
    dist_drawdown <= DANGER_THRESHOLD
      ? 'bg-red-500'
      : dist_drawdown <= CAUTION_THRESHOLD
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  const isBreached = status === 'breached'
  const isStale    = status === 'stale'

  return (
    <div
      className={[
        'rounded-2xl border p-4 space-y-3 transition-all',
        isBreached
          ? 'border-red-500/50 bg-red-950/30'
          : isStale
            ? 'border-zinc-700/50 bg-zinc-900/60 opacity-60'
            : dist_drawdown <= DANGER_THRESHOLD
              ? 'border-red-500/40 bg-zinc-900'
              : dist_drawdown <= CAUTION_THRESHOLD
                ? 'border-amber-500/30 bg-zinc-900'
                : 'border-zinc-800 bg-zinc-900',
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isBest && (
            <span title="Best day P&L" className="text-base leading-none">
              👑
            </span>
          )}
          <p className="text-xs font-semibold text-zinc-100 break-all leading-tight font-mono">
            {account_id}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={[
              'text-[10px] px-2 py-0.5 rounded-full font-semibold',
              isBreached
                ? 'bg-red-500/20 text-red-400'
                : isStale
                  ? 'bg-zinc-700/40 text-zinc-500'
                  : 'bg-emerald-500/10 text-emerald-400',
            ].join(' ')}
          >
            {isBreached ? 'BREACHED' : isStale ? 'STALE' : 'LIVE'}
          </span>
          <span className="text-[9px] text-zinc-600">{secondsAgo(last_update)}</span>
        </div>
      </div>

      {/* PnL summary */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-800/40 p-2.5">
        <Metric label="Day P&L" value={fmt(dayPnl)} className={pnlColor(dayPnl)} />
        <Metric label="Total Available" value={fmtBalance(total_available)} />
      </div>

      {/* Main metrics — mirrors mobile card in main.py */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Metric
          label="Dollar Open"
          value={fmt(dollar_open)}
          className={pnlColor(dollar_open)}
        />
        <Metric
          label="Dist Daily Loss"
          value={fmt(dist_to_daily_loss)}
          className={distColor(dist_to_daily_loss)}
        />
        <Metric label="Drawdown Auto" value={fmt(drawdown_auto)} />
        <Metric label="Trailing Max"  value={fmt(trailing_max)} />
        <Metric
          label="Dist Drawdown"
          value={fmt(dist_drawdown)}
          className={distColor(dist_drawdown)}
        />
        <Metric label="Realized P&L" value={fmt(realized_pnl)} className={pnlColor(realized_pnl)} />
      </div>

      {/* Drawdown gauge */}
      <div className="space-y-1">
        <div className="flex justify-between text-[9px] text-zinc-600">
          <span>Drawdown buffer</span>
          <span className="font-mono">{ddPct.toFixed(1)}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${gaugeColor}`}
            style={{ width: `${ddPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
