'use client'
// components/StatusBar.tsx
// Mirrors the status pill + clock from main.py dashboard

import { useEffect, useState } from 'react'
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

      {/* Right: status + clock */}
      <div className="flex items-center gap-3">
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
            updated {lastUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
          </span>
        )}

        <span className="text-xs font-mono text-zinc-500">{clock}</span>
      </div>
    </div>
  )
}
