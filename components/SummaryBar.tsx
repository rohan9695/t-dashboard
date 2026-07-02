'use client'
// components/SummaryBar.tsx
// Three stat cards mirroring main.py.
// Header balance/P&L hidden by default; eye icon to reveal/hide.

import { useRealtime } from './RealtimeProvider'
import { useVisibility } from './VisibilityProvider'

function fmtBalance(n: number) {
  const v = Math.round(n || 0)
  const sign = v < 0 ? '-' : ''
  return sign + '$' + Math.abs(v).toLocaleString('en-US')
}

function fmtPnl(n: number) {
  const v = n || 0
  const sign = v < 0 ? '-' : '+'
  return (
    sign +
    '$' +
    Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

const HIDDEN = '••••••'

interface StatProps {
  label: string
  value: string
  valueClass?: string
}
function Stat({ label, value, valueClass = 'text-zinc-100' }: StatProps) {
  return (
    <div className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 p-3 sm:p-4 text-center min-w-0">
      <p className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-widest mb-1 truncate">{label}</p>
      <p className={`text-lg sm:text-2xl font-bold font-mono tracking-tight truncate ${valueClass}`}>{value}</p>
    </div>
  )
}

export function SummaryBar() {
  const { accounts } = useRealtime()
  const { visible, toggle } = useVisibility()

  const active = accounts.filter((a) => a.status === 'active' && !a.hidden)

  let totalBalance = 0
  let totalProfit  = 0

  for (const a of active) {
    totalBalance += a.total_available || 0
    totalProfit  +=
      (a.realized_pnl || 0) + (a.unrealized_pnl || a.dollar_open || 0)
  }

  const profitColor =
    totalProfit > 0
      ? 'text-emerald-400'
      : totalProfit < 0
        ? 'text-red-400'
        : 'text-zinc-400'

  return (
    <div className="relative flex gap-3">
      <Stat label="Total Accounts" value={String(active.length)} />
      <Stat
        label="Total Balance"
        value={visible ? fmtBalance(totalBalance) : HIDDEN}
      />
      <Stat
        label="Total Profit"
        value={visible ? fmtPnl(totalProfit) : HIDDEN}
        valueClass={visible ? profitColor : 'text-zinc-500'}
      />

      {/* Eye icon — top-right of the group */}
      <button
        onClick={toggle}
        aria-label={visible ? 'Hide balances' : 'Show balances'}
        className="absolute -top-2 right-0 p-2 text-zinc-500 hover:text-zinc-300 transition-colors min-h-[44pt] min-w-[44pt] flex items-center justify-center"
      >
        {visible ? (
          // Eye-slash (hide)
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          // Eye (show)
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
            <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
