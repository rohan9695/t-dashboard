'use client'
// components/analytics/PnLCalendar.tsx
// 12-month GitHub-style P&L calendar heatmap.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface DayData { date: string; pnl: number }

export function PnLCalendar() {
  const [days, setDays] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 365 * 24 * 3600_000).toISOString()
      const { data } = await supabase
        .from('trade_events')
        .select('pnl, occurred_at')
        .eq('event_type', 'close')
        .gte('occurred_at', since)
      setLoading(false)
      if (!data) return
      const map: Record<string, number> = {}
      for (const row of data) {
        const key = new Date(row.occurred_at as string).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        map[key] = (map[key] ?? 0) + Number(row.pnl ?? 0)
      }
      setDays(map)
    }
    load()
  }, [supabase])

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-xl" />

  // Build last 52 weeks of day cells
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cells: DayData[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    const key = d.toLocaleDateString('en-CA')
    cells.push({ date: key, pnl: days[key] ?? 0 })
  }

  // Pad start to Monday
  const startDay = new Date(cells[0].date).getDay() // 0=Sun
  const pad = (startDay + 6) % 7 // days to prepend as empty

  function cellBg(pnl: number): string {
    if (pnl === 0)    return 'bg-zinc-800'
    if (pnl > 500)    return 'bg-emerald-500'
    if (pnl > 200)    return 'bg-emerald-700'
    if (pnl > 0)      return 'bg-emerald-900'
    if (pnl > -200)   return 'bg-red-900'
    if (pnl > -500)   return 'bg-red-700'
    return 'bg-red-500'
  }

  const weeks: (DayData | null)[][] = []
  const flat: (DayData | null)[] = [...Array(pad).fill(null), ...cells]
  for (let i = 0; i < flat.length; i += 7) {
    weeks.push(flat.slice(i, i + 7))
  }

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-4">P&L Calendar (12m)</h3>
      <div className="overflow-x-auto">
        <div className="flex gap-0.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((day, di) => (
                <div
                  key={di}
                  className={`w-2.5 h-2.5 rounded-sm ${day ? cellBg(day.pnl) : 'bg-transparent'}`}
                  title={day ? `${day.date}: ${day.pnl >= 0 ? '+' : ''}$${Math.round(day.pnl)}` : ''}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
