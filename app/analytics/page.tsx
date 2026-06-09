'use client'
// app/analytics/page.tsx
// Analytics dashboard — only renders meaningful content when trade_journal is ON.
// Each chart section is gated independently by its own preference flag.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PREFERENCE_DEFAULTS, type PreferenceKey } from '@/lib/preferences'
import { EquityCurve } from '@/components/analytics/EquityCurve'
import { ProfitFactor } from '@/components/analytics/ProfitFactor'
import { WinRateHeatmap } from '@/components/analytics/WinRateHeatmap'
import { PnLCalendar } from '@/components/analytics/PnLCalendar'
import { AIInsights } from '@/components/analytics/AIInsights'

type Prefs = Record<PreferenceKey, boolean>

export default function AnalyticsPage() {
  const router = useRouter()
  const [prefs, setPrefs] = useState<Prefs>({ ...PREFERENCE_DEFAULTS })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('user_preferences').select('preference_key, value')
      if (data) {
        setPrefs((prev) => {
          const next = { ...prev }
          for (const row of data) {
            const key = row.preference_key as PreferenceKey
            if (key in PREFERENCE_DEFAULTS) next[key] = Boolean((row.value as { v: boolean }).v)
          }
          return next
        })
      }
      setLoading(false)
    }
    load()
  }, [supabase])

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
      </div>
    )
  }

  if (!prefs.trade_journal) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="text-4xl">📊</div>
        <div>
          <h1 className="text-xl font-bold mb-2">Analytics disabled</h1>
          <p className="text-zinc-500 text-sm max-w-xs">
            Enable Trade Journal in Settings to auto-log fills and unlock all analytics.
          </p>
        </div>
        <button
          onClick={() => router.push('/settings')}
          className="min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm"
        >
          Open Settings
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="min-h-[44pt] min-w-[44pt] flex items-center justify-center text-zinc-400 hover:text-zinc-200 -ml-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-lg font-bold tracking-tight">Analytics</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {prefs.equity_curve   && <EquityCurve />}
        {prefs.profit_factor  && <ProfitFactor />}
        {prefs.win_rate_heatmap && <WinRateHeatmap />}
        {prefs.pnl_calendar   && <PnLCalendar />}
        {prefs.ai_pattern_detection && <AIInsights />}

        {!prefs.equity_curve && !prefs.profit_factor && !prefs.win_rate_heatmap && !prefs.pnl_calendar && !prefs.ai_pattern_detection && (
          <div className="text-center py-20 text-zinc-500 text-sm">
            No analytics widgets enabled. Go to Settings → Analytics to turn them on.
          </div>
        )}
      </div>
    </div>
  )
}
