'use client'
// components/AccountsGrid.tsx
// Renders all account cards, marks the best day P&L with the crown (mirrors main.py).
// Shows empty state when no accounts are connected.

import { useRealtime } from './RealtimeProvider'
import { AccountCard } from './AccountCard'

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

  // Crown: account with best day P&L (mirrors main.py bestAcc logic)
  let bestPnl  = -Infinity
  let bestAccId: string | null = null
  for (const row of active) {
    const pnl = (row.realized_pnl || 0) + (row.unrealized_pnl || row.dollar_open || 0)
    if (pnl > bestPnl) {
      bestPnl  = pnl
      bestAccId = row.account_id
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {active.map((row) => (
        <AccountCard
          key={row.account_id}
          row={row}
          isBest={active.length > 1 && row.account_id === bestAccId}
        />
      ))}
    </div>
  )
}
