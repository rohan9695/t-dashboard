'use client'
// components/HeartbeatMonitor.tsx
// "NinjaTrader offline" banner — no data has arrived from NT8 for a while.
//
// Deliberately distinct from SyncBanner: this means the DATA stopped coming,
// SyncBanner means this BROWSER stopped receiving. Different causes, different
// fixes, so they must never be merged.
//
// Reads the accounts already held by RealtimeProvider rather than querying
// Supabase itself. The old version issued its own anon-key query every 10s,
// which RLS denies — it returned an empty array, hit the `if (!data) return`
// guard, and the banner therefore never appeared at all. Deriving it from
// state that is already loaded fixes that and removes a duplicate query.

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { formatAge } from './AccountCard'

const HEARTBEAT_TIMEOUT_MS = 10 * 60_000 // 10 minutes — NT8 quiet between trades is normal

export function HeartbeatMonitor() {
  const { accounts } = useRealtime()
  const [now, setNow] = useState(() => Date.now())

  // Re-evaluate on a timer so the banner appears, and its age counts up,
  // without needing new data to arrive.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const visible = accounts.filter((a) => !a.hidden)
  if (visible.length === 0) return null

  // Freshest account wins: one live account means NT8 is still sending.
  const newest = visible.reduce((max, a) => {
    const t = new Date(a.last_update).getTime()
    return Number.isFinite(t) && t > max ? t : max
  }, 0)
  if (newest === 0) return null

  const ageMs = now - newest
  if (ageMs <= HEARTBEAT_TIMEOUT_MS) return null

  return (
    <div className="bg-red-950/60 border-b border-red-800/50 text-red-300 text-xs font-medium px-4 py-2 flex items-center justify-center gap-2 text-center">
      <span className="animate-pulse shrink-0">🔴</span>
      <span>NinjaTrader offline — no data for {formatAge(Math.floor(ageMs / 1_000))}</span>
    </div>
  )
}
