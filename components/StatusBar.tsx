'use client'
// components/StatusBar.tsx

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRealtime } from './RealtimeProvider'

export function StatusBar() {
  const { connected, accounts, lastUpdate } = useRealtime()
  const [clock, setClock] = useState('')

  useEffect(() => {
    function tick() {
      setClock(
        new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }),
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const liveCount = accounts.filter((a) => a.status === 'active').length

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 44 44" fill="none" className="w-8 h-8 shrink-0">
          <circle cx="16" cy="22" r="11" stroke="white" strokeWidth="2.2" />
          <circle cx="28" cy="22" r="11" stroke="white" strokeWidth="2.2" />
        </svg>
        <span className="text-lg font-bold tracking-tight text-zinc-100">
          Trader Dashboard
        </span>
      </div>

      {/* Right: status + clock + gear */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-800/60 border border-zinc-700/50 rounded-full px-3 py-1.5">
          <span
            className={[
              'w-2 h-2 rounded-full transition-colors',
              connected ? 'bg-emerald-400 shadow-[0_0_6px_#4ade80]' : 'bg-red-500',
            ].join(' ')}
          />
          <span className="text-zinc-300">
            {connected ? `${liveCount} live` : 'Disconnected'}
          </span>
        </div>

        {lastUpdate && (
          <span className="text-[11px] text-zinc-600 hidden sm:block">
            {lastUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
          </span>
        )}

        <span className="text-xs font-mono text-zinc-500">{clock}</span>

        {/* Settings gear — 44pt tap target */}
        <Link
          href="/settings"
          aria-label="Settings"
          className="flex items-center justify-center min-h-[44pt] min-w-[44pt] text-zinc-500 hover:text-zinc-300 transition-colors -mr-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
