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
}

const Ctx = createContext<RealtimeCtx>({
  accounts: [],
  connected: false,
  lastUpdate: null,
  loading: true,
  refresh: async () => {},
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

  // Stable supabase client — never recreated across renders
  const supabaseRef = useRef(createClient())
  const channelRef = useRef<ReturnType<typeof supabaseRef.current.channel> | null>(null)

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
      const { data } = await supabaseRef.current
        .from('accounts')
        .select('*')
        .order('account_id')

      if (data) {
        setAccounts(data as AccountRow[])
        setLastUpdate(new Date())
      }
    } catch {
      // Keep existing data on error; let realtime re-sync
    } finally {
      setLoading(false)
      // Always re-establish a fresh realtime channel after fetch
      subscribe()
    }
  }, [subscribe])

  // Initial subscription on mount
  useEffect(() => {
    subscribe()
    return () => {
      channelRef.current?.unsubscribe()
    }
  }, [subscribe])

  // Polling fallback — fetches fresh data every 15 s in case Realtime
  // events are silently dropped (e.g. RLS not yet configured for anon role)
  useEffect(() => {
    const id = setInterval(async () => {
      // Only poll if the tab is visible to avoid waking a backgrounded PWA
      if (document.hidden) return
      try {
        const { data } = await supabaseRef.current
          .from('accounts')
          .select('*')
          .order('account_id')
        if (data && data.length > 0) {
          setAccounts(data as AccountRow[])
          setLastUpdate(new Date())
          setLoading(false)
        }
      } catch {
        // Silently ignore — Realtime is the primary path
      }
    }, 15_000)
    return () => clearInterval(id)
  }, [])

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
    <Ctx.Provider value={{ accounts, connected, lastUpdate, loading, refresh }}>
      {children}
    </Ctx.Provider>
  )
}
