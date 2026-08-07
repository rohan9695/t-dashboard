'use client'
// components/RealtimeProvider.tsx
// Manages Supabase Realtime subscription + forced refresh on foreground.
// On visibilitychange (hidden → visible): fetches fresh snapshot then
// explicitly unsubscribes and resubscribes — never relies on auto-reconnect.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AccountRow } from '@/lib/trading-logic'

interface RealtimeCtx {
  accounts: AccountRow[]
  connected: boolean
  lastUpdate: Date | null
  loading: boolean
  refresh: () => Promise<void>
  /** When the browser last actually pulled rows. Null until the first success. */
  lastSync: Date | null
  /** True once reads have been failing long enough that what's shown may be stale. */
  syncFailed: boolean
}

const Ctx = createContext<RealtimeCtx>({
  accounts: [],
  connected: false,
  lastUpdate: null,
  loading: true,
  refresh: async () => {},
  lastSync: null,
  syncFailed: false,
})

export function useRealtime() {
  return useContext(Ctx)
}

export function RealtimeProvider({
  children,
  initialAccounts,
}: {
  children: React.ReactNode
  initialAccounts: AccountRow[]
}) {
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts)
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  // Only show loading skeleton if we have no initial data
  const [loading, setLoading] = useState(initialAccounts.length === 0)

  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)

  // Stable supabase client — never recreated across renders
  const supabaseRef = useRef(createClient())
  const channelRef = useRef<ReturnType<typeof supabaseRef.current.channel> | null>(null)
  const failStreak = useRef(0)

  // Single source of truth for pulling rows.
  //
  // The browser reads with the anon key, and RLS on `accounts` grants SELECT to
  // the authenticated role only. A denied SELECT under RLS comes back as an
  // EMPTY ARRAY, not an error — so a read that returns nothing is
  // indistinguishable from "there are no accounts", and the old code discarded
  // it silently and kept showing whatever the server render produced. That
  // freezes the dashboard at page-load state with no visible symptom, which is
  // the worst possible failure for a risk display.
  //
  // So: try the cheap direct read first, and if it yields nothing, fall back to
  // /api/data, which runs server-side under the service role and is unaffected
  // by RLS. Returns null only when BOTH paths fail.
  const fetchAccounts = useCallback(async (): Promise<AccountRow[] | null> => {
    try {
      const { data, error } = await supabaseRef.current
        .from('accounts')
        .select('*')
        .order('account_id')
      if (!error && data && data.length > 0) return data as AccountRow[]
      if (error) console.warn('[sync] direct read failed:', error.message)
    } catch (e) {
      console.warn('[sync] direct read threw:', e)
    }

    try {
      // Same row set as the direct read — all=1 skips the staleness cutoff so
      // offline accounts still render greyed instead of vanishing.
      const res = await fetch('/api/data?all=1', { cache: 'no-store' })
      if (!res.ok) {
        console.warn('[sync] /api/data returned', res.status)
        return null
      }
      const json = (await res.json()) as Record<string, AccountRow>
      return Object.values(json)
    } catch (e) {
      console.warn('[sync] /api/data threw:', e)
      return null
    }
  }, [])

  // Apply a fetch result and keep the sync-health flags honest.
  const applyRows = useCallback((rows: AccountRow[] | null) => {
    if (rows === null) {
      failStreak.current += 1
      // Three consecutive misses (~9s) before crying wolf, so a single blip
      // doesn't flash a warning at someone watching a live position.
      if (failStreak.current >= 3) setSyncFailed(true)
      return false
    }
    failStreak.current = 0
    setSyncFailed(false)
    setAccounts(rows)
    setLastSync(new Date())
    setLastUpdate(new Date())
    setLoading(false)
    return true
  }, [])

  const subscribe = useCallback(() => {
    const supabase = supabaseRef.current

    // Tear down any existing channel before creating a new one
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
      setConnected(false)
    }

    // Unique channel name prevents Supabase from reusing a stale socket
    const channel = supabase
      .channel(`accounts-live-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accounts' },
        (payload) => {
          const updated = payload.new as AccountRow | null
          const deleted = payload.old as { account_id?: string } | null

          setAccounts((prev) => {
            if (payload.eventType === 'DELETE' && deleted?.account_id) {
              return prev.filter((a) => a.account_id !== deleted.account_id)
            }
            if (!updated) return prev
            const idx = prev.findIndex((a) => a.account_id === updated.account_id)
            if (idx === -1) return [...prev, updated]
            const next = [...prev]
            next[idx] = updated
            return next
          })

          setLastUpdate(new Date())
          setLoading(false)
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel
  }, []) // deps intentionally empty — reads only stable refs

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      applyRows(await fetchAccounts())
    } finally {
      setLoading(false)
      // Always re-establish a fresh realtime channel after fetch
      subscribe()
    }
  }, [subscribe, fetchAccounts, applyRows])

  // Initial subscription + immediate data fetch on mount
  // The server-side render may return empty (service key missing) — this ensures
  // the anon client always hydrates accounts within ~500ms of page load.
  useEffect(() => {
    subscribe()

    void (async () => {
      applyRows(await fetchAccounts())
    })()

    return () => {
      channelRef.current?.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Polling fallback — fetches fresh data every 3 s so live trades appear
  // immediately even if Supabase Realtime events are dropped
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return
      applyRows(await fetchAccounts())
    }, 3_000)
    return () => clearInterval(id)
  }, [fetchAccounts, applyRows])

  // Force refresh when app returns to foreground
  useEffect(() => {
    let wasHidden = false

    function handleVisibility() {
      if (document.hidden) {
        wasHidden = true
      } else if (wasHidden) {
        wasHidden = false
        refresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refresh])

  return (
    <Ctx.Provider value={{ accounts, connected, lastUpdate, loading, refresh, lastSync, syncFailed }}>
      {children}
    </Ctx.Provider>
  )
}
