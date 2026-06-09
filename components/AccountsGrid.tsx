'use client'

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { AccountRow } from './AccountCard'

const COLUMNS = [
  { label: '',               align: 'left'  },
  { label: 'Account',        align: 'left'  },
  { label: 'Cash Value',     align: 'right' },
  { label: 'Dist Daily Loss',align: 'right' },
  { label: 'Drawdown Auto',  align: 'right' },
  { label: 'Trailing Max',   align: 'right' },
  { label: 'Dist Drawdown',  align: 'right' },
  { label: 'Dollar Open',    align: 'right' },
  { label: 'Realized P&L',  align: 'right' },
  { label: 'Unrealized P&L',align: 'right' },
  { label: 'Day P&L',        align: 'right' },
  { label: 'Buffer',         align: 'right' },
]

const COL_COUNT = COLUMNS.length

// Skeleton placeholder row shown while data loads
function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-800 animate-pulse">
      <td className="px-3 py-4 w-8">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-700" />
      </td>
      <td className="px-3 py-4 min-w-[160px]">
        <div className="h-2.5 bg-zinc-700 rounded w-36 mb-2" />
        <div className="h-2 bg-zinc-800 rounded w-14" />
      </td>
      {Array.from({ length: COL_COUNT - 2 }).map((_, i) => (
        <td key={i} className="px-3 py-4">
          <div className="h-2.5 bg-zinc-800 rounded w-16 ml-auto" />
        </td>
      ))}
    </tr>
  )
}

export function AccountsGrid() {
  const { accounts, loading } = useRealtime()

  // Tick every 5 s so "Xs ago" timestamps stay roughly accurate without a
  // timer inside every row
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const active = accounts
    .filter((a) => a.status !== 'stale')
    .sort((a, b) => a.account_id.localeCompare(b.account_id))

  const tableHeader = (
    <thead>
      <tr className="border-b border-zinc-700 bg-zinc-900/80">
        {COLUMNS.map((col) => (
          <th
            key={col.label}
            className={`px-3 py-2.5 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
          >
            {col.label}
          </th>
        ))}
      </tr>
    </thead>
  )

  // Show skeleton rows on first load (no data yet)
  if (loading && active.length === 0) {
    return (
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left border-collapse">
          {tableHeader}
          <tbody>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </tbody>
        </table>
      </div>
    )
  }

  if (active.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">
          📡
        </div>
        <p className="text-zinc-400 text-sm">No accounts connected</p>
        <p className="text-zinc-600 text-xs max-w-xs">
          Enable AccountMonitor in NinjaTrader and point it at your Vercel URL
        </p>
      </div>
    )
  }

  let bestPnl = -Infinity
  let bestAccId: string | null = null
  for (const row of active) {
    const pnl = (row.realized_pnl || 0) + (row.unrealized_pnl || row.dollar_open || 0)
    if (pnl > bestPnl) { bestPnl = pnl; bestAccId = row.account_id }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-left border-collapse">
        {tableHeader}
        <tbody>
          {active.map((row) => (
            <AccountRow
              key={row.account_id}
              row={row}
              isBest={active.length > 1 && row.account_id === bestAccId}
              now={now}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
