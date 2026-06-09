'use client'
// components/analytics/WinRateHeatmap.tsx
// Hour × day grid of win rates from trade_events.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const HOURS = Array.from({ length: 9 }, (_, i) => i + 9) // 9am - 5pm

interface Cell { wins: number; total: number }
type Grid = Record<string, Record<number, Cell>> // day → hour → cell

export function WinRateHeatmap() {
  const [grid, setGrid] = useState<Grid>({})
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      // Last 30 days
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
      const { data } = await supabase
        .from('trade_events')
        .select('pnl, occurred_at')
        .eq('event_type', 'close')
        .gte('occurred_at', since)
      setLoading(false)
      if (!data) return

      const g: Grid = {}
      for (const row of data) {
        const dt  = new Date(row.occurred_at as string)
        const day = dt.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
        const hr  = parseInt(dt.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
        if (!g[day]) g[day] = {}
        if (!g[day][hr]) g[day][hr] = { wins: 0, total: 0 }
        g[day][hr].total += 1
        if (Number(row.pnl ?? 0) > 0) g[day][hr].wins += 1
      }
      setGrid(g)
    }
    load()
  }, [supabase])

  if (loading) return <div className="h-40 animate-pulse bg-zinc-800 rounded-xl" />

  function cellColor(day: string, hour: number): string {
    const cell = grid[day]?.[hour]
    if (!cell || cell.total === 0) return 'bg-zinc-800'
    const rate = cell.wins / cell.total
    if (rate >= 0.7) return 'bg-emerald-600'
    if (rate >= 0.5) return 'bg-emerald-900'
    if (rate >= 0.3) return 'bg-amber-900'
    return 'bg-red-900'
  }

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-4">Win Rate by Hour (30d)</h3>
      <div className="overflow-x-auto">
        <table className="text-[9px] text-zinc-500">
          <thead>
            <tr>
              <th className="pr-2 text-right w-8" />
              {HOURS.map((h) => (
                <th key={h} className="px-0.5 text-center w-7">
                  {h % 12 || 12}{h < 12 ? 'a' : 'p'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day}>
                <td className="pr-2 text-right font-medium text-zinc-400">{day}</td>
                {HOURS.map((h) => {
                  const cell = grid[day]?.[h]
                  return (
                    <td key={h} className="px-0.5 py-0.5">
                      <div
                        className={`w-6 h-6 rounded ${cellColor(day, h)}`}
                        title={cell ? `${cell.wins}/${cell.total} wins` : 'No data'}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 mt-3 text-[9px] text-zinc-600">
          <span className="w-3 h-3 rounded bg-emerald-600 inline-block" /> 70%+
          <span className="w-3 h-3 rounded bg-emerald-900 inline-block ml-2" /> 50–70%
          <span className="w-3 h-3 rounded bg-amber-900 inline-block ml-2" /> 30–50%
          <span className="w-3 h-3 rounded bg-red-900 inline-block ml-2" /> &lt;30%
        </div>
      </div>
    </div>
  )
}
