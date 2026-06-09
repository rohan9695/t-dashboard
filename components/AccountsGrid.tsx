'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { AccountRow } from './AccountCard'
import { ColumnPicker, ALL_COLUMNS } from './ColumnPicker'
import type { ColumnDef } from './ColumnPicker'

const OFFLINE_THRESHOLD_MS = 5 * 60_000 // 5 minutes

function isOffline(row: { last_update: string; dollar_open: number }): boolean {
  const stale = Date.now() - new Date(row.last_update).getTime() > OFFLINE_THRESHOLD_MS
  return stale && row.dollar_open === 0
}

const COL_COUNT = ALL_COLUMNS.length

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr className="border-b border-zinc-800 animate-pulse">
      <td className="px-3 py-4 w-8">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-700" />
      </td>
      <td className="px-3 py-4 min-w-[160px]">
        <div className="h-2.5 bg-zinc-700 rounded w-36 mb-2" />
        <div className="h-2 bg-zinc-800 rounded w-14" />
      </td>
      {Array.from({ length: colCount - 2 }).map((_, i) => (
        <td key={i} className="px-3 py-4">
          <div className="h-2.5 bg-zinc-800 rounded w-16 ml-auto" />
        </td>
      ))}
    </tr>
  )
}

const DEFAULT_VISIBLE = ALL_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.key)

export function AccountsGrid() {
  const { accounts, loading } = useRealtime()

  const [visibleKeys, setVisibleKeys] = useState<string[]>(DEFAULT_VISIBLE)
  const [pickerOpen, setPickerOpen] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  const handleHeaderLongPress = useCallback(() => {
    setPickerOpen(true)
  }, [])

  const onHeaderPointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(handleHeaderLongPress, 600)
  }, [handleHeaderLongPress])

  const onHeaderPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Sorted: active first (by account_id), then offline (greyed, sorted by last_update)
  const sorted = [...accounts].sort((a, b) => {
    const aOff = isOffline(a)
    const bOff = isOffline(b)
    if (aOff !== bOff) return aOff ? 1 : -1
    return a.account_id.localeCompare(b.account_id)
  })

  const visibleCols: ColumnDef[] = ALL_COLUMNS.filter((c) => visibleKeys.includes(c.key))

  const tableHeader = (
    <thead>
      <tr
        className="border-b border-zinc-700 bg-zinc-900/80 cursor-pointer select-none"
        onPointerDown={onHeaderPointerDown}
        onPointerUp={onHeaderPointerUp}
        onPointerLeave={onHeaderPointerUp}
        title="Long press to customize columns"
      >
        {visibleCols.map((col) => (
          <th
            key={col.key}
            className={`px-3 py-2.5 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold whitespace-nowrap min-w-[80px] ${col.align === 'right' ? 'text-right' : 'text-left'}`}
          >
            {col.label}
          </th>
        ))}
      </tr>
    </thead>
  )

  if (loading && accounts.length === 0) {
    return (
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left border-collapse">
          {tableHeader}
          <tbody>
            <SkeletonRow colCount={COL_COUNT} />
            <SkeletonRow colCount={COL_COUNT} />
            <SkeletonRow colCount={COL_COUNT} />
          </tbody>
        </table>
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📡</div>
        <p className="text-zinc-400 text-sm">No accounts connected</p>
        <p className="text-zinc-600 text-xs max-w-xs">Enable AccountMonitor in NinjaTrader and point it at your Vercel URL</p>
      </div>
    )
  }

  const activeAccounts = sorted.filter((r) => r.status !== 'stale' && !isOffline(r))
  let bestPnl = -Infinity
  let bestAccId: string | null = null
  for (const row of activeAccounts) {
    const pnl = (row.realized_pnl || 0) + (row.unrealized_pnl || row.dollar_open || 0)
    if (pnl > bestPnl) { bestPnl = pnl; bestAccId = row.account_id }
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left border-collapse">
          {tableHeader}
          <tbody>
            {sorted.map((row) => {
              const offline = isOffline(row)
              return (
                <AccountRow
                  key={row.account_id}
                  row={row}
                  isBest={activeAccounts.length > 1 && row.account_id === bestAccId}
                  now={now}
                  offline={offline}
                  visibleKeys={visibleKeys}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {pickerOpen && (
        <ColumnPicker
          visible={visibleKeys}
          onClose={() => setPickerOpen(false)}
          onChange={(keys) => setVisibleKeys(keys)}
        />
      )}
    </>
  )
}
