'use client'
// components/ColumnPicker.tsx
// Bottom-sheet column picker opened by long-pressing any column header.
// Saves preferences to Supabase user_preferences (best-effort — not required for display).

import { useEffect, useRef, useState } from 'react'

export interface ColumnDef {
  key: string
  label: string
  align: 'left' | 'right'
  defaultVisible: boolean
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'status',             label: '',              align: 'left',  defaultVisible: true  },
  { key: 'account',            label: 'Account',       align: 'left',  defaultVisible: true  },
  { key: 'total_available',    label: 'Cash Value',    align: 'right', defaultVisible: true  },
  { key: 'dist_to_daily_loss', label: 'Dist Daily Loss',align:'right', defaultVisible: true  },
  { key: 'drawdown_auto',      label: 'Drawdown Auto', align: 'right', defaultVisible: false },
  { key: 'trailing_max',       label: 'Trailing Max',  align: 'right', defaultVisible: false },
  { key: 'dist_drawdown',      label: 'Dist Drawdown', align: 'right', defaultVisible: true  },
  { key: 'dollar_open',        label: 'Dollar Open',   align: 'right', defaultVisible: false },
  { key: 'realized_pnl',       label: 'Realized P&L', align: 'right', defaultVisible: true  },
  { key: 'unrealized_pnl',     label: 'Unrealized P&L',align:'right', defaultVisible: true  },
  { key: 'day_pnl',            label: 'Total P&L',     align: 'right', defaultVisible: true  },
  { key: 'buffer',             label: 'Buffer',        align: 'right', defaultVisible: false },
]

interface ColumnPickerProps {
  visible: string[]
  onClose: () => void
  onChange: (keys: string[]) => void
}

export function ColumnPicker({ visible, onClose, onChange }: ColumnPickerProps) {
  const [order, setOrder] = useState<string[]>(ALL_COLUMNS.map((c) => c.key))
  const [checked, setChecked] = useState<Set<string>>(new Set(visible))
  const dragKey = useRef<string | null>(null)
  const dragOverKey = useRef<string | null>(null)

  useEffect(() => {
    setChecked(new Set(visible))
  }, [visible])

  function toggleColumn(key: string) {
    // Never hide status dot or account name
    if (key === 'status' || key === 'account') return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleApply() {
    const visibleInOrder = order.filter((k) => checked.has(k))
    onChange(visibleInOrder)
    onClose()
  }

  function onDragStart(key: string) { dragKey.current = key }
  function onDragEnter(key: string) { dragOverKey.current = key }
  function onDragEnd() {
    const from = dragKey.current
    const to   = dragOverKey.current
    if (!from || !to || from === to) return
    setOrder((prev) => {
      const next = [...prev]
      const fi   = next.indexOf(from)
      const ti   = next.indexOf(to)
      next.splice(fi, 1)
      next.splice(ti, 0, from)
      return next
    })
    dragKey.current = null
    dragOverKey.current = null
  }

  const colsByKey = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c]))

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-2xl pb-safe">
        <div className="w-10 h-1 bg-zinc-600 rounded-full mx-auto mt-3 mb-4" />
        <div className="px-4 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Columns</h3>
          <p className="text-[11px] text-zinc-500">Drag to reorder · tap to toggle</p>
        </div>

        <div className="px-4 space-y-1 max-h-80 overflow-y-auto">
          {order.map((key) => {
            const col = colsByKey[key]
            if (!col) return null
            const isLocked = key === 'status' || key === 'account'
            const isOn     = checked.has(key)

            return (
              <div
                key={key}
                draggable={!isLocked}
                onDragStart={() => onDragStart(key)}
                onDragEnter={() => onDragEnter(key)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-zinc-800/60 min-h-[44pt] select-none"
              >
                <span className="text-zinc-500 cursor-grab text-sm">{isLocked ? '🔒' : '⠿'}</span>
                <span className="flex-1 text-sm text-zinc-200">
                  {col.label || 'Status dot'}
                </span>
                <button
                  onClick={() => toggleColumn(key)}
                  disabled={isLocked}
                  className={`w-11 h-6 rounded-full transition-colors ${isOn ? 'bg-emerald-500' : 'bg-zinc-700'} ${isLocked ? 'opacity-40' : ''}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white mx-0.5 transition-transform ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="px-4 pt-4 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44pt] bg-zinc-800 text-zinc-300 rounded-xl text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 min-h-[44pt] bg-zinc-100 text-zinc-900 rounded-xl text-sm font-semibold"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  )
}
