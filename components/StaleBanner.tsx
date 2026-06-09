'use client'

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'

const STALE_THRESHOLD_MS = 60_000 // 60 seconds

export function StaleBanner() {
  const { accounts, loading } = useRealtime()
  const [now, setNow] = useState(Date.now())

  // Tick every second to keep "Xm ago" text accurate
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (loading || accounts.length === 0) return null

  const oldestUpdate = Math.min(
    ...accounts.map((a) => new Date(a.last_update).getTime()),
  )
  const allStale = now - oldestUpdate > STALE_THRESHOLD_MS

  if (!allStale) return null

  const ageSeconds = Math.floor((now - oldestUpdate) / 1_000)
  const ageText =
    ageSeconds < 120 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`

  return (
    <div className="bg-amber-900/30 border-b border-amber-700/40 text-amber-400 text-xs font-medium px-4 py-2 text-center flex items-center justify-center gap-2">
      <span className="animate-pulse">⚠️</span>
      <span>Reconnecting… last update {ageText} ago</span>
    </div>
  )
}
