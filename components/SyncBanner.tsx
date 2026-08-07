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
  const { syncFailed, lastSync } = useRealtime()
  const [, tick] = useState(0)

  // Re-render on a timer so the age text keeps counting up while stuck.
  useEffect(() => {
    if (!syncFailed) return
    const id = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [syncFailed])

  if (!syncFailed) return null

  const ageText = lastSync
    ? formatAge(Math.floor((Date.now() - lastSync.getTime()) / 1_000))
    : null

  return (
    <div className="bg-amber-950/70 border-b border-amber-800/60 text-amber-200 text-xs font-medium px-4 py-2 flex items-center justify-center gap-2 text-center">
      <span className="animate-pulse shrink-0">⚠️</span>
      <span>
        Dashboard not updating — numbers below are{' '}
        {ageText ? `${ageText} old` : 'not live'}. Check risk in NinjaTrader.
      </span>
    </div>
  )
}
