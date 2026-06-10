'use client'
// components/analytics/AIInsights.tsx
// Shows the latest AI pattern detection insight from Supabase ai_insights table.
// Insights are generated weekly by the Supabase ai-analysis Edge Function.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Insight {
  id: string
  summary: string
  patterns: string[]
  generated_at: string
}

export function AIInsights() {
  const [insight, setInsight] = useState<Insight | null>(null)
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    async function load() {
      const { data } = await supabaseRef.current
        .from('ai_insights')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(1)
        .single()
      setLoading(false)
      if (data) setInsight(data as Insight)
    }
    load()
  }, [])

  if (loading) return <div className="h-32 animate-pulse bg-zinc-800 rounded-xl" />

  if (!insight) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
        <h3 className="text-xs uppercase tracking-widest text-zinc-500 mb-2">AI Pattern Detection</h3>
        <p className="text-zinc-600 text-sm text-center py-6">
          No insights yet — the weekly analysis runs on Sunday at midnight.
        </p>
      </div>
    )
  }

  const genDate = new Date(insight.generated_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-zinc-500">AI Pattern Detection</h3>
        <span className="text-[10px] text-zinc-600">{genDate}</span>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed mb-3">{insight.summary}</p>
      {insight.patterns.length > 0 && (
        <ul className="space-y-1">
          {insight.patterns.map((p, i) => (
            <li key={i} className="flex gap-2 text-xs text-zinc-400">
              <span className="text-zinc-600 shrink-0">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
