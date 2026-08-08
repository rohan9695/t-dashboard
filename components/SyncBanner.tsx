'use client'
// components/SyncBanner.tsx
// Warns when THIS BROWSER has stopped pulling fresh rows.
//
// Deliberately distinct from HeartbeatMonitor: that one means "NT8 stopped
// sending", this one means "the dashboard stopped receiving". They have
// different fixes, and the earlier StaleBanner was removed precisely because it
// conflated the two and cried "reconnecting" whenever NT8 was simply quiet.
//
// This only fires on a real fetch failure — both the direct Supabase read and
// the /api/data fallback failing in a row — never on NT8 being idle.

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { formatAge } from './AccountCard'

export function SyncBanner() {
  const { syncFailed, fromCache, lastSync } = useRealtime()
  const [, tick] = useState(0)

  const degraded = syncFailed || fromCache

  // Re-render on a timer so the age text keeps counting up while stuck.
  useEffect(() => {
    if (!degraded) return
    const id = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [degraded])

  if (!degraded) return null

  const ageText = lastSync
    ? formatAge(Math.floor((Date.now() - lastSync.getTime()) / 1_000))
    : null

  // Two different situations, two different things to do about them. Saved data
  // means the numbers are real but old; not-updating means the live connection
  // dropped and a tap on Refresh may fix it.
  const message = syncFailed
    ? `Dashboard not updating — figures below are ${ageText ? `${ageText} old` : 'not live'}. Tap Refresh, and check risk in NinjaTrader.`
    : `Showing saved data from ${ageText ?? 'earlier'} — reconnecting.`

  return (
    <div className="bg-amber-950/70 border-b border-amber-800/60 text-amber-200 text-xs font-medium px-4 py-2 flex items-center justify-center gap-2 text-center">
      <span className={`shrink-0 ${syncFailed ? 'animate-pulse' : ''}`}>⚠️</span>
      <span>{message}</span>
    </div>
  )
}
