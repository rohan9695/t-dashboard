'use client'
// components/analytics/ProfitFactor.tsx
// Wins / losses ratio, red if below 1.0.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function ProfitFactor() {
  const [pf, setPf] = useState<number | null>(null)
  const [winRate, setWinRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    async function load() {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const { data } = await supabaseRef.current
        .from('trade_events')
        .select('pnl')
        .eq('event_type', 'close')
        .gte('occurred_at', today.toISOString())
      setLoading(false)
      if (!data || data.length === 0) return
      const wins   = data.filter((r) => Number(r.pnl ?? 0) > 0)
      const losses = data.filter((r) => Number(r.pnl ?? 0) < 0)
      const grossWin  = wins.reduce((s, r) => s + Number(r.pnl), 0)
      const grossLoss = Math.abs(losses.reduce((s, r) => s + Number(r.pnl), 0))
      setPf(grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null)
      setWinRate(Math.round((wins.length / data.length) * 100))
    }
    load()
  }, [])

  if (loading) return <div className="h-20 animate-pulse bg-zinc-800 rounded-xl" />

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex gap-6">
      <div className="text-center flex-1">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Profit Factor</p>
        <p className={`text-3xl font-bold font-mono ${pf === null ? 'text-zinc-600' : pf >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
          {pf === null ? '—' : pf.toFixed(2)}
        </p>
      </div>
      <div className="text-center flex-1">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Win Rate</p>
        <p className={`text-3xl font-bold font-mono ${winRate === null ? 'text-zinc-600' : winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
          {winRate === null ? '—' : `${winRate}%`}
        </p>
      </div>
    </div>
  )
}
