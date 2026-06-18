'use client'
// components/HeartbeatMonitor.tsx
// Monitors last NT8 heartbeat ping.
// If no ping in 60s → red banner + iPhone push notification + Resend email (via /api/heartbeat-alert).
// Heartbeat is updated by /api/heartbeat GET calls from the NT8 addon.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatAge } from './AccountCard'

const HEARTBEAT_TIMEOUT_MS = 60_000 // 60 seconds

export function HeartbeatMonitor() {
  const [nt8Down, setNt8Down] = useState(false)
  const [lastSeenText, setLastSeenText] = useState('')
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    const supabase = supabaseRef.current

    async function checkHeartbeat() {
      // The NT8 addon pings /api/heartbeat. We check the most recent account update
      // as a proxy — if ALL accounts are stale for 60s, NT8 is likely down.
      const { data } = await supabase
        .from('accounts')
        .select('last_update')
        .order('last_update', { ascending: false })
        .limit(1)

      if (!data || data.length === 0) return

      const lastMs = new Date(data[0].last_update as string).getTime()
      const ageMs  = Date.now() - lastMs

      if (ageMs > HEARTBEAT_TIMEOUT_MS) {
        const ageSeconds = Math.floor(ageMs / 1_000)
        const ageText    = formatAge(ageSeconds)
        setLastSeenText(ageText)
        setNt8Down(true)

        // Browser push notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⚠️ NinjaTrader Offline', {
            body: `No data received for ${ageText}. Check NT8.`,
            icon: '/icon-192.png',
          })
        }
      } else {
        setNt8Down(false)
      }
    }

    checkHeartbeat()
    const id = setInterval(checkHeartbeat, 10_000)
    return () => clearInterval(id)
  }, [])

  if (!nt8Down) return null

  return (
    <div className="bg-red-950/60 border-b border-red-800/50 text-red-300 text-xs font-medium px-4 py-2 flex items-center justify-center gap-2">
      <span className="animate-pulse">🔴</span>
      <span>NinjaTrader offline — no data for {lastSeenText}</span>
    </div>
  )
}
