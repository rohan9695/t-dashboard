'use client'
// components/RefreshButton.tsx
// Manual refresh, so recovering from a stuck view never requires closing and
// reopening the app.
//
// refresh() re-pulls rows (direct read, falling back to /api/data) and tears
// down and re-subscribes the realtime channel, which is the part that a
// backgrounded PWA usually loses.

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { formatAge } from './AccountCard'

export function RefreshButton({ showAge = true }: { showAge?: boolean }) {
  const { refresh, lastSync, syncFailed } = useRealtime()
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  // Keep the "updated Ns ago" text counting up on its own.
  useEffect(() => {
    if (!showAge) return
    const id = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [showAge])

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      await refresh()
    } finally {
      // Hold the spinner briefly — a refresh that completes in 80ms otherwise
      // gives no feedback at all, and the tap reads as though nothing happened.
      setTimeout(() => setBusy(false), 400)
    }
  }

  const ageText =
    lastSync != null
      ? formatAge(Math.floor((Date.now() - lastSync.getTime()) / 1_000))
      : null

  return (
    <div className="flex items-center gap-1.5">
      {showAge && ageText && !busy && (
        <span className={`text-[10px] tabular-nums ${syncFailed ? 'text-amber-500' : 'text-zinc-600'}`}>
          {ageText} ago
        </span>
      )}
      <button
        onClick={handleClick}
        disabled={busy}
        aria-label="Refresh data"
        title="Refresh data"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-[11px] font-medium active:bg-zinc-700 disabled:opacity-60 transition-colors min-h-[36px]"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}
          aria-hidden
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        {busy ? 'Refreshing' : 'Refresh'}
      </button>
    </div>
  )
}
