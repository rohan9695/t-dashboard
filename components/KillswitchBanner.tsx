'use client'
// components/KillswitchBanner.tsx
// Shows a red KILLSWITCH ACTIVE banner at the top of the dashboard.
// Reset requires double-tap (confirmation) to avoid accidental deactivation.

import { useEffect, useState } from 'react'

const KILLSWITCH_TOKEN = '' // set only in dev — in prod this is server-side only

export function KillswitchBanner() {
  const [active, setActive] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)

  useEffect(() => {
    async function checkKillswitch() {
      try {
        const res = await fetch('/api/killswitch')
        if (!res.ok) return
        const data = (await res.json()) as { killswitch: boolean }
        setActive(data.killswitch)
      } catch { /* non-critical */ }
    }
    checkKillswitch()
    // Re-check every 30 seconds
    const id = setInterval(checkKillswitch, 30_000)
    return () => clearInterval(id)
  }, [])

  if (!active) return null

  const handleReset = () => {
    if (!confirmPending) {
      setConfirmPending(true)
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirmPending(false), 3_000)
      return
    }
    // Second tap: actually reset
    setConfirmPending(false)
    fetch('/api/killswitch/reset', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KILLSWITCH_TOKEN}` },
    })
      .then((r) => r.json())
      .then((d: { deactivated?: boolean }) => { if (d.deactivated) setActive(false) })
      .catch(() => { /* non-critical */ })
  }

  return (
    <div className="bg-red-900 border-b border-red-700 text-red-100 text-xs font-semibold px-4 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="animate-pulse text-red-300">⛔</span>
        <span>KILLSWITCH ACTIVE — All API endpoints returning 503</span>
      </div>
      <button
        onClick={handleReset}
        className="shrink-0 bg-red-700 hover:bg-red-600 border border-red-500 rounded px-3 py-1 text-[11px] font-semibold transition-colors min-h-[36px] min-w-[80px]"
      >
        {confirmPending ? 'Tap again to reset' : 'Reset'}
      </button>
    </div>
  )
}
