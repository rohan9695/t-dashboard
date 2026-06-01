'use client'
// components/SummaryBar.tsx
// Mirrors the three stat cards from main.py:
//   Total Accounts, Total Balance, Total Profit

import { useRealtime } from './RealtimeProvider'

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

interface StatProps {
  label: string
  value: string
  valueClass?: string
}
function Stat({ label, value, valueClass = 'text-zinc-100' }: StatProps) {
  return (
    <div className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center">
      <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono tracking-tight ${valueClass}`}>{value}</p>
    </div>
  )
}

export function SummaryBar() {
  const { accounts } = useRealtime()

  const active = accounts.filter((a) => a.status === 'active')

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
    <div className="flex gap-3">
      <Stat label="Total Accounts" value={String(active.length)} />
      <Stat label="Total Balance"  value={fmtBalance(totalBalance)} />
      <Stat
        label="Total Profit"
        value={fmtPnl(totalProfit)}
        valueClass={profitColor}
      />
    </div>
  )
}
