'use client'

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

export function AccountsGrid() {
  const { accounts } = useRealtime()

  const active = accounts
    .filter((a) => a.status !== 'stale')
    .sort((a, b) => a.account_id.localeCompare(b.account_id))

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
        <tbody>
          {active.map((row) => (
            <AccountRow
              key={row.account_id}
              row={row}
              isBest={active.length > 1 && row.account_id === bestAccId}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
