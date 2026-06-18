'use client'

import { useEffect, useState } from 'react'
import { DANGER_THRESHOLD, CAUTION_THRESHOLD, type AccountRow } from '@/lib/trading-logic'

const STALE_MS = 60_000 // 60 s — amber threshold

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

export function formatAge(seconds: number): string {
  if (seconds < 60)    return `${seconds}s`
  if (seconds < 120)   return '1m'
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m`
  if (seconds < 7200)  return '1h'
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 172800) return '1d'
  return `${Math.floor(seconds / 86400)}d`
}

export function secondsAgo(iso: string, now = Date.now()): { text: string; stale: boolean } {
  const s = Math.floor((now - new Date(iso).getTime()) / 1_000)
  const stale = s >= 60
  return { text: `${formatAge(s)} ago`, stale }
}

const DASH = '——'

function ReplikantoTag({ role }: { role?: 'leader' | 'follower' | null }) {
  if (!role) return null
  return role === 'leader' ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-violet-900/60 text-violet-300 border border-violet-700/50">
      Leader
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-zinc-800 text-zinc-500 border border-zinc-700/50">
      Follower
    </span>
  )
}

// Renders a single account table row.
// `offline` = true applies grey treatment (Task 3D).
// `visibleKeys` controls which columns are rendered.
export function AccountRow({
  row,
  isBest,
  now,
  offline = false,
  visibleKeys,
}: {
  row: AccountRow
  isBest: boolean
  now: number
  offline?: boolean
  visibleKeys?: string[]
}) {
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

  const dayPnl    = (realized_pnl || 0) + (unrealized_pnl || dollar_open || 0)
  const isBreached = status === 'breached'

  const { text: ageText, stale: isAged } = secondsAgo(last_update, now)
  // isAged = last_update older than 60s (same threshold as HeartbeatMonitor + StaleBanner)
  const isStale = isAged

  const rowBg = offline
    ? 'opacity-40 bg-zinc-900/30'
    : isBreached
      ? 'bg-red-950/30'
      : isStale
        ? 'bg-zinc-900/40 opacity-60'
        : 'bg-zinc-900 hover:bg-zinc-800/60'

  const show = (key: string) => !visibleKeys || visibleKeys.includes(key)
  const val  = (content: React.ReactNode) => offline ? <span className="text-zinc-600">{DASH}</span> : content

  return (
    <tr className={`border-b border-zinc-800 transition-all duration-300 ${rowBg}`}>
      {show('status') && (
        <td className="px-3 py-3 w-8">
          {offline ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-700" />
          ) : (
            <span className={[
              'inline-block w-2.5 h-2.5 rounded-full',
              isBreached ? 'bg-red-500' : isStale ? 'bg-zinc-600' : 'bg-emerald-400',
            ].join(' ')} />
          )}
        </td>
      )}

      {show('account') && (
        <td className="px-3 py-3 min-w-[160px]">
          <div className="flex items-center gap-1.5">
            {isBest && !offline && <span title="Best day P&L" className="text-sm">👑</span>}
            <span className={`text-xs font-mono font-semibold break-all ${offline ? 'text-zinc-500' : 'text-zinc-100'}`}>
              {account_id}
            </span>
            {/* Tradovate live data indicator */}
            {row.tradovate_synced_at && !offline && (
              <span title="Tradovate live data connected" className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            )}
            {!row.tradovate_synced_at && !offline && (
              <span title="NT8 only — Tradovate values missing" className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" />
            )}
          </div>
          <ReplikantoTag role={row.replikanto_role} />
          {/* Apex Drawdown: show real Tradovate value if available */}
          {row.tradovate_trailing_drawdown != null && !offline && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] text-zinc-500">Apex DD:</span>
              <span className={`text-[9px] font-mono ${distColor(row.tradovate_trailing_drawdown)}`}>
                {fmt(row.tradovate_trailing_drawdown)}
              </span>
              {/* Amber variance badge if >$50 difference from calculated */}
              {Math.abs((row.tradovate_trailing_drawdown) - (row.dist_drawdown)) > 50 && (
                <span className="text-[8px] bg-amber-900/60 text-amber-400 px-1 rounded">
                  Δ${Math.round(Math.abs(row.tradovate_trailing_drawdown - row.dist_drawdown))}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1">
            {offline && <span className="text-[9px] text-zinc-600 font-medium">OFFLINE</span>}
            {!offline && (
              <span className={`text-[9px] ${isAged ? 'text-amber-500' : 'text-zinc-600'}`}>
                {ageText}
              </span>
            )}
          </div>
        </td>
      )}

      {show('total_available') && (
        <td className="px-3 py-3 text-right font-mono text-sm text-zinc-100">
          {val(fmtBalance(total_available))}
        </td>
      )}

      {show('dist_to_daily_loss') && (
        <td className={`px-3 py-3 text-right font-mono text-sm ${offline ? 'text-zinc-600' : distColor(dist_to_daily_loss)}`}>
          {val(fmt(dist_to_daily_loss))}
        </td>
      )}

      {show('drawdown_auto') && (
        <td className="px-3 py-3 text-right font-mono text-sm text-zinc-300">
          {val(fmt(drawdown_auto))}
        </td>
      )}

      {show('trailing_max') && (
        <td className="px-3 py-3 text-right font-mono text-sm text-zinc-300">
          {val(fmt(trailing_max))}
        </td>
      )}

      {show('dist_drawdown') && (
        <td className={`px-3 py-3 text-right font-mono text-sm ${offline ? 'text-zinc-600' : distColor(dist_drawdown)}`}>
          {val(fmt(dist_drawdown))}
        </td>
      )}

      {show('dollar_open') && (
        <td className={`px-3 py-3 text-right font-mono text-sm ${offline ? 'text-zinc-600' : pnlColor(dollar_open)}`}>
          {val(fmt(dollar_open))}
        </td>
      )}

      {show('realized_pnl') && (
        <td className={`px-3 py-3 text-right font-mono text-sm ${offline ? 'text-zinc-600' : pnlColor(realized_pnl)}`}>
          {val(fmt(realized_pnl))}
        </td>
      )}

      {show('unrealized_pnl') && (
        <td className={`px-3 py-3 text-right font-mono text-sm ${offline ? 'text-zinc-600' : pnlColor(unrealized_pnl)}`}>
          {val(fmt(unrealized_pnl))}
        </td>
      )}

      {show('day_pnl') && (
        <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${offline ? 'text-zinc-600' : pnlColor(dayPnl)}`}>
          {val(fmt(dayPnl))}
        </td>
      )}

      {show('buffer') && (
        <td className="px-3 py-3 w-24">
          {offline ? (
            <span className="text-zinc-600 text-xs">{DASH}</span>
          ) : (
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
          )}
        </td>
      )}
    </tr>
  )
}

// Keep AccountCard as alias for backward compat
export function AccountCard({ row, isBest }: { row: AccountRow; isBest: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])
  return <AccountRow row={row} isBest={isBest} now={now} />
}

// Compact single-row list item for the mobile list view
export function MobileListRow({
  row,
  isBest,
  now,
  offline = false,
}: {
  row: AccountRow
  isBest: boolean
  now: number
  offline?: boolean
}) {
  const {
    account_id, dollar_open, dist_to_daily_loss, dist_drawdown,
    realized_pnl, unrealized_pnl, trailing_max, last_update, status,
  } = row

  const dayPnl     = (realized_pnl || 0) + (unrealized_pnl || dollar_open || 0)
  const isBreached = status === 'breached'
  const { text: ageText, stale: isAged } = secondsAgo(last_update, now)

  const dotColor = offline
    ? 'bg-zinc-700'
    : isBreached ? 'bg-red-500' : isAged ? 'bg-zinc-600' : 'bg-emerald-400'

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800/70 last:border-0 ${offline ? 'opacity-40' : ''}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

      <div className="w-[90px] shrink-0 min-w-0">
        <div className="flex items-center gap-1">
          {isBest && !offline && <span className="text-[9px] text-amber-400 shrink-0">👑</span>}
          <span className="text-[11px] font-mono font-semibold text-zinc-100 truncate">{account_id}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-[9px] ${offline ? 'text-zinc-600' : isAged ? 'text-amber-500' : 'text-zinc-600'}`}>
            {offline ? 'OFFLINE' : ageText}
          </span>
          <ReplikantoTag role={row.replikanto_role} />
        </div>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-0.5 text-right">
        <div>
          <p className="text-[8px] text-zinc-600 uppercase tracking-wide">DD Buf</p>
          <p className={`text-[11px] font-mono font-semibold leading-tight ${offline ? 'text-zinc-600' : distColor(dist_drawdown)}`}>
            {offline ? DASH : fmt(dist_drawdown)}
          </p>
        </div>
        <div>
          <p className="text-[8px] text-zinc-600 uppercase tracking-wide">Daily</p>
          <p className={`text-[11px] font-mono font-semibold leading-tight ${offline ? 'text-zinc-600' : distColor(dist_to_daily_loss)}`}>
            {offline ? DASH : fmt(dist_to_daily_loss)}
          </p>
        </div>
        <div>
          <p className="text-[8px] text-zinc-600 uppercase tracking-wide">Day P&L</p>
          <p className={`text-[11px] font-mono font-semibold leading-tight ${offline ? 'text-zinc-600' : pnlColor(dayPnl)}`}>
            {offline ? DASH : fmt(dayPnl)}
          </p>
        </div>
      </div>
    </div>
  )
}

// Mobile card — 2-col risk grid, no horizontal scroll needed
export function MobileAccountCard({
  row,
  isBest,
  now,
  offline = false,
}: {
  row: AccountRow
  isBest: boolean
  now: number
  offline?: boolean
}) {
  const {
    account_id, dollar_open, dist_to_daily_loss, total_available,
    trailing_max, dist_drawdown, realized_pnl, unrealized_pnl,
    last_update, status,
  } = row

  const dayPnl     = (realized_pnl || 0) + (unrealized_pnl || dollar_open || 0)
  const isBreached = status === 'breached'
  const { text: ageText, stale: isAged } = secondsAgo(last_update, now)
  const isStale = isAged

  const dotColor = offline
    ? 'bg-zinc-700'
    : isBreached ? 'bg-red-500' : isStale ? 'bg-zinc-600' : 'bg-emerald-400'

  const cardBorder = isBreached ? 'border-red-800/50 bg-red-950/20' : 'border-zinc-800 bg-zinc-900'

  return (
    <div className={`rounded-xl border p-4 ${cardBorder} ${offline ? 'opacity-40' : ''}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
          {isBest && !offline && <span className="shrink-0 text-sm">👑</span>}
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate">{account_id}</span>
          <ReplikantoTag role={row.replikanto_role} />
        </div>
        <span className={`text-[10px] shrink-0 ml-2 ${offline ? 'text-zinc-600' : isAged ? 'text-amber-500' : 'text-zinc-600'}`}>
          {offline ? 'OFFLINE' : ageText}
        </span>
      </div>

      {/* Two main risk metrics */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1.5">DD Buffer</p>
          <p className={`text-base font-mono font-semibold ${offline ? 'text-zinc-600' : distColor(dist_drawdown)}`}>
            {offline ? DASH : fmt(dist_drawdown)}
          </p>
          {!offline && trailing_max > 0 && (
            <div className="mt-2 h-1 w-full rounded-full bg-zinc-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  dist_drawdown <= DANGER_THRESHOLD ? 'bg-red-500'
                    : dist_drawdown <= CAUTION_THRESHOLD ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, (dist_drawdown / trailing_max) * 100))}%` }}
              />
            </div>
          )}
        </div>

        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1.5">Daily Left</p>
          <p className={`text-base font-mono font-semibold ${offline ? 'text-zinc-600' : distColor(dist_to_daily_loss)}`}>
            {offline ? DASH : fmt(dist_to_daily_loss)}
          </p>
        </div>
      </div>

      {/* Bottom: open / day / equity in one line */}
      <div className="flex items-center justify-between text-[11px]">
        <span>
          <span className="text-zinc-600">Open </span>
          <span className={`font-mono ${offline ? 'text-zinc-600' : pnlColor(dollar_open)}`}>
            {offline ? DASH : fmt(dollar_open)}
          </span>
        </span>
        <span>
          <span className="text-zinc-600">Day </span>
          <span className={`font-mono font-semibold ${offline ? 'text-zinc-600' : pnlColor(dayPnl)}`}>
            {offline ? DASH : fmt(dayPnl)}
          </span>
        </span>
        <span>
          <span className="text-zinc-600">Eq </span>
          <span className={`font-mono ${offline ? 'text-zinc-600' : 'text-zinc-300'}`}>
            {offline ? DASH : fmtBalance(total_available)}
          </span>
        </span>
      </div>
    </div>
  )
}
