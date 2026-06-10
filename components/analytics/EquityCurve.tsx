'use client'
// components/analytics/EquityCurve.tsx
// Running P&L line chart per session, built from trade_events.
// Uses SVG only — no charting library dependency.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface PnLPoint { ts: number; cumPnl: number }

export function EquityCurve() {
  const [points, setPoints] = useState<PnLPoint[]>([])
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    async function load() {
      // Today's closed trades
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { data } = await supabaseRef.current
        .from('trade_events')
        .select('pnl, occurred_at')
        .eq('event_type', 'close')
        .gte('occurred_at', today.toISOString())
        .order('occurred_at')
      setLoading(false)
      if (!data) return
      let cum = 0
      const pts: PnLPoint[] = data.map((r) => {
        cum += Number(r.pnl ?? 0)
        return { ts: new Date(r.occurred_at as string).getTime(), cumPnl: cum }
      })
      setPoints(pts)
    }
    load()
  }, [])

  if (loading) return <div className="h-40 animate-pulse bg-zinc-800 rounded-xl" />
  if (points.length === 0) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
        <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Equity Curve</h3>
        <p className="text-zinc-600 text-sm text-center py-8">No closed trades today</p>
      </div>
    )
  }

  const W = 320; const H = 120; const PAD = 16
  const minPnl = Math.min(0, ...points.map((p) => p.cumPnl))
  const maxPnl = Math.max(0, ...points.map((p) => p.cumPnl))
  const range  = maxPnl - minPnl || 1
  const minTs  = points[0].ts
  const maxTs  = points[points.length - 1].ts || minTs + 1
  const spanTs = maxTs - minTs || 1

  function px(p: PnLPoint) {
    const x = PAD + ((p.ts - minTs) / spanTs) * (W - PAD * 2)
    const y = PAD + ((maxPnl - p.cumPnl) / range) * (H - PAD * 2)
    return [x, y] as [number, number]
  }

  const pathD = points.map((p, i) => {
    const [x, y] = px(p)
    return (i === 0 ? 'M' : 'L') + `${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')

  const lastPnl = points[points.length - 1].cumPnl
  const lineColor = lastPnl >= 0 ? '#4ade80' : '#f87171'

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-zinc-500">Equity Curve</h3>
        <span className={`text-sm font-mono font-semibold ${lastPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {lastPnl >= 0 ? '+' : ''}${Math.round(lastPnl).toLocaleString()}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
        {/* Zero line */}
        {(() => {
          const zeroY = PAD + (maxPnl / range) * (H - PAD * 2)
          return <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#3f3f46" strokeDasharray="4 2" />
        })()}
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
