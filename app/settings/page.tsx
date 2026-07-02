'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_LABELS,
  type PreferenceKey,
} from '@/lib/preferences'

type PrefsState = Record<PreferenceKey, boolean>

interface LeaderCandidate {
  account_id: string
  replikanto_role: 'leader' | 'follower' | null
}

const SECTIONS: Array<{ title: string; keys: PreferenceKey[] }> = [
  {
    title: 'Notifications',
    keys: ['toast_notifications', 'haptic_alerts', 'heartbeat_monitor'],
  },
  {
    title: 'Display',
    keys: ['balance_hidden_default', 'grey_disconnected', 'health_score_column', 'skull_indicator'],
  },
  {
    title: 'Risk Controls',
    keys: ['auto_risk_lockout', 'account_quarantine', 'session_auto_lockout'],
  },
  {
    title: 'Analytics',
    keys: [
      'trade_journal', 'daily_pnl_snapshot', 'equity_curve',
      'profit_factor', 'win_rate_heatmap', 'pnl_calendar', 'ai_pattern_detection',
    ],
  },
]

const LS_KEY = 'td_preferences'

function lsLoad(): Partial<PrefsState> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    return raw ? (JSON.parse(raw) as Partial<PrefsState>) : {}
  } catch { return {} }
}

function lsSave(prefs: PrefsState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)) } catch { /* non-critical */ }
}

export default function SettingsPage() {
  const router = useRouter()
  const [prefs, setPrefs] = useState<PrefsState>({ ...PREFERENCE_DEFAULTS })
  const [saving, setSaving] = useState<Set<PreferenceKey>>(new Set())
  const [accounts, setAccounts] = useState<LeaderCandidate[]>([])
  const [settingLeader, setSettingLeader] = useState<string | null>(null)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    supabaseRef.current
      .from('accounts')
      .select('account_id, replikanto_role')
      .eq('hidden', false)
      .order('account_id')
      .then(({ data }) => {
        if (data) setAccounts(data as LeaderCandidate[])
      })
  }, [])

  const setLeader = useCallback(async (accountId: string) => {
    setSettingLeader(accountId)
    setAccounts((prev) => prev.map((a) => ({
      ...a,
      replikanto_role: a.account_id === accountId ? 'leader' : (a.replikanto_role === 'leader' ? 'follower' : a.replikanto_role),
    })))
    try {
      await fetch('/api/set-leader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId }),
      })
    } catch { /* non-critical — dashboard realtime will resync on next update */ }
    setSettingLeader(null)
  }, [])

  useEffect(() => {
    // Instant restore from localStorage — no loading flash
    const cached = lsLoad()
    if (Object.keys(cached).length > 0) {
      setPrefs((p) => ({ ...p, ...cached }))
    }

    // Best-effort sync from Supabase (overrides cache if DB has data)
    supabaseRef.current
      .from('user_preferences')
      .select('preference_key, value')
      .then(({ data }) => {
        if (!data || data.length === 0) return
        setPrefs((prev) => {
          const next = { ...prev }
          for (const row of data) {
            const key = row.preference_key as PreferenceKey
            if (key in PREFERENCE_DEFAULTS) {
              next[key] = Boolean((row.value as { v: boolean }).v)
            }
          }
          lsSave(next)
          return next
        })
      })
  }, [])

  const toggle = useCallback(async (key: PreferenceKey) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      lsSave(next) // always persists locally, even if Supabase is unavailable
      return next
    })
    setSaving((s) => new Set(s).add(key))

    // Best-effort cloud save — no revert on failure; localStorage is the source of truth
    await supabaseRef.current
      .from('user_preferences')
      .upsert(
        { preference_key: key, value: { v: !prefs[key] }, updated_at: new Date().toISOString() },
        { onConflict: 'preference_key' },
      )

    setSaving((s) => { const n = new Set(s); n.delete(key); return n })
  }, [prefs])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header — header-safe clears Dynamic Island on iPhone */}
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
        <h1 className="text-lg font-bold tracking-tight">Settings</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
        {accounts.length > 0 && (
          <div>
            <h2 className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3 px-1">
              Replikanto Leader
            </h2>
            <div className="space-y-1">
              {accounts.map((a) => {
                const isLeader = a.replikanto_role === 'leader'
                const isBusy   = settingLeader === a.account_id
                return (
                  <div
                    key={a.account_id}
                    role="button"
                    aria-pressed={isLeader}
                    onClick={() => { if (!isLeader && !isBusy) setLeader(a.account_id) }}
                    className={`flex items-center gap-3 bg-zinc-900 border rounded-xl px-4 py-3 min-h-[56px] select-none ${
                      isLeader ? 'border-violet-700/60' : 'border-zinc-800 cursor-pointer active:bg-zinc-800/80'
                    }`}
                  >
                    <span className="flex-1 text-sm font-mono text-zinc-100 truncate">{a.account_id}</span>
                    {isLeader ? (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest bg-violet-900/60 text-violet-300 border border-violet-700/50 rounded px-2 py-1">
                        Leader
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-zinc-500">{isBusy ? 'Setting…' : 'Set as leader'}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3 px-1">
              {section.title}
            </h2>
            <div className="space-y-1">
              {section.keys.map((key) => {
                const { label, description } = PREFERENCE_LABELS[key]
                const isOn     = prefs[key]
                const isSaving = saving.has(key)

                return (
                  // Full row is the tap target — much easier on iPhone than a 28px toggle
                  <div
                    key={key}
                    role="button"
                    aria-pressed={isOn}
                    aria-label={`${isOn ? 'Disable' : 'Enable'} ${label}`}
                    onClick={() => { if (!isSaving) toggle(key) }}
                    className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 min-h-[62px] cursor-pointer active:bg-zinc-800/80 select-none"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-100 leading-tight">{label}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 leading-tight">{description}</p>
                    </div>
                    {/* Toggle visual — pointer-events-none, parent row handles taps */}
                    <div
                      aria-hidden="true"
                      className={`shrink-0 w-12 h-7 rounded-full transition-colors duration-200 pointer-events-none ${
                        isSaving ? 'opacity-60' : ''
                      } ${isOn ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white mt-1 mx-1 transition-transform duration-200 ${
                          isOn ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <p className="text-[10px] text-zinc-700 text-center pb-4">
          Changes save instantly · Trader Dashboard
        </p>
      </div>
    </div>
  )
}
