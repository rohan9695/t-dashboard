'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PREFERENCE_DEFAULTS, type PreferenceKey } from '@/lib/preferences'
import { EquityCurve } from '@/components/analytics/EquityCurve'
import { ProfitFactor } from '@/components/analytics/ProfitFactor'
import { WinRateHeatmap } from '@/components/analytics/WinRateHeatmap'
import { PnLCalendar } from '@/components/analytics/PnLCalendar'
import { AIInsights } from '@/components/analytics/AIInsights'

type Prefs = Record<PreferenceKey, boolean>

const LS_KEY = 'td_preferences'

export default function AnalyticsPage() {
  const router = useRouter()
  const [prefs, setPrefs] = useState<Prefs>({ ...PREFERENCE_DEFAULTS })
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    // localStorage only exists in the browser — must be read in useEffect, not useState
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as Partial<Prefs>
        setPrefs((p) => ({ ...p, ...cached }))
      }
    } catch { /* ignore */ }
    setPrefsLoaded(true)

    // Best-effort Supabase sync
    supabaseRef.current
      .from('user_preferences')
      .select('preference_key, value')
      .then(({ data }) => {
        if (!data || data.length === 0) return
        setPrefs((prev) => {
          const next = { ...prev }
          for (const row of data) {
            const key = row.preference_key as PreferenceKey
            if (key in PREFERENCE_DEFAULTS) next[key] = Boolean((row.value as { v: boolean }).v)
          }
          return next
        })
      })
  }, [])

  const analyticsWidgets = [
    { key: 'equity_curve'         as PreferenceKey, node: <EquityCurve /> },
    { key: 'profit_factor'        as PreferenceKey, node: <ProfitFactor /> },
    { key: 'win_rate_heatmap'     as PreferenceKey, node: <WinRateHeatmap /> },
    { key: 'pnl_calendar'         as PreferenceKey, node: <PnLCalendar /> },
    { key: 'ai_pattern_detection' as PreferenceKey, node: <AIInsights /> },
  ]

  const enabledWidgets = analyticsWidgets.filter((w) => prefs[w.key])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 px-4 pb-3 header-safe flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="min-h-[44pt] min-w-[44pt] flex items-center justify-center text-zinc-400 hover:text-zinc-200 -ml-2"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-lg font-bold tracking-tight">Analytics</h1>
      </header>

      {/* Spinner until localStorage is read — prevents "no widgets" flash */}
      {!prefsLoaded ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {/* Trade Journal notice — soft warning, not a hard gate */}
          {!prefs.trade_journal && enabledWidgets.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl bg-amber-950/40 border border-amber-800/50 px-4 py-3">
              <span className="text-amber-400 shrink-0 mt-0.5">⚠️</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-200">Trade Journal is off</p>
                <p className="text-xs text-amber-400/80 mt-0.5">
                  Enable <strong>Trade Journal</strong> in Settings to start logging fills. Widgets will show real data once trades are recorded.
                </p>
                <button
                  onClick={() => router.push('/settings')}
                  className="mt-2 text-xs text-amber-300 underline underline-offset-2"
                >
                  Open Settings
                </button>
              </div>
            </div>
          )}

          {/* Enabled widgets */}
          {enabledWidgets.map((w) => (
            <div key={w.key}>{w.node}</div>
          ))}

          {/* Nothing enabled */}
          {enabledWidgets.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-6 py-20 text-center px-8">
              <div className="text-4xl">📊</div>
              <div>
                <h2 className="text-lg font-bold text-zinc-100 mb-2">No analytics widgets enabled</h2>
                <p className="text-zinc-500 text-sm max-w-xs">
                  Go to Settings → Analytics and tap the widgets you want to see here.
                </p>
              </div>
              <button
                onClick={() => router.push('/settings')}
                className="min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
              >
                Open Settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
