'use client'
// components/RealtimeProvider.tsx
// Subscribes to Supabase Realtime on the accounts table.
// Replaces the 5-second polling loop in main.py's dashboard JS.

import {
  createContext,
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
}

const Ctx = createContext<RealtimeCtx>({
  accounts: [],
  connected: false,
  lastUpdate: null,
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
  const supabase = createClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('accounts-live')
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
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [])

  return (
    <Ctx.Provider value={{ accounts, connected, lastUpdate }}>
      {children}
    </Ctx.Provider>
  )
}
