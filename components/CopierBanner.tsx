'use client'
// components/CopierBanner.tsx
// Two copier problems, one banner, worst-first.
//
// 1. NOT COPYING (during a trade) — the leader holds an open position and a
//    live follower is still flat. The copy did not happen.
//
// 2. NOT READY (no trade needed) — an account has stopped reporting while the
//    others carry on. A trade fired now could not reach it, whatever Replikanto
//    is doing. This is the pre-trade warning: it does not wait for money to be
//    at risk before telling you something is wrong.
//
// The readiness check works because NT8 sends every account in ONE batch, so
// their last_update timestamps move together. Comparing each account against
// the FRESHEST one — rather than against the clock — is what separates "NT8 is
// quiet right now" (everything equally old, nothing wrong) from "this account
// dropped" (one far behind the rest). Every other staleness check in the app is
// absolute and cannot make that distinction.
//
// What this CANNOT tell you: whether Replikanto itself is connected. That state
// lives inside NinjaTrader and nothing reports it here. Accounts reporting is a
// precondition for copying, not proof of it. To know Replikanto's own status the
// NT8 addon would have to read it and POST it.
//
// The NOT COPYING check depends on open P&L: dollar_open is fed by NT8's
// UnrealizedProfitLoss / DollarOpen items. If the addon does not subscribe to
// those, every account reads flat and only the readiness check can fire.

import { useEffect, useRef, useState } from 'react'
import { useRealtime } from './RealtimeProvider'

// A copied order should land well inside this.
const GRACE_MS = 45_000
// Matches AccountsGrid — past this an account is offline and not expected to fill.
const OFFLINE_MS = 30 * 60_000
// How far behind the freshest account before it counts as having dropped. NT8
// flushes every 3s in-window and every 30s outside it, so 3 minutes is several
// missed batches — comfortably past normal jitter.
const LAG_MS = 3 * 60_000

export function CopierBanner() {
  const { accounts } = useRealtime()
  const [, tick] = useState(0)
  // When the leader's current position was first seen. Cleared when it closes.
  const openedAt = useRef<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const visible = accounts.filter((a) => !a.hidden)
  if (visible.length < 2) return null // nothing to copy between

  const leader = visible.find((a) => a.replikanto_role === 'leader')
  const now = Date.now()
  const stamp = (a: { last_update: string }) => new Date(a.last_update).getTime()

  // ── 1. Not copying ────────────────────────────────────────────────────────
  const leaderOpen = leader ? (leader.dollar_open ?? 0) !== 0 : false
  if (!leaderOpen) openedAt.current = null
  else if (openedAt.current === null) openedAt.current = now

  if (leader && leaderOpen && openedAt.current !== null && now - openedAt.current >= GRACE_MS) {
    const online = visible.filter(
      (a) => a.account_id !== leader.account_id && now - stamp(a) <= OFFLINE_MS,
    )
    const flat = online.filter((a) => (a.dollar_open ?? 0) === 0)
    if (flat.length > 0) {
      return (
        <Banner tone="danger" icon="🔁">
          Replikanto not copying — leader is in a position, {flat.length} of {online.length}{' '}
          account{online.length === 1 ? '' : 's'} still flat.
        </Banner>
      )
    }
  }

  // ── 2. Not ready ──────────────────────────────────────────────────────────
  const newest = visible.reduce((max, a) => Math.max(max, stamp(a) || 0), 0)
  if (newest === 0) return null

  const laggards = visible.filter((a) => newest - stamp(a) > LAG_MS)
  if (laggards.length === 0) return null

  const reachable = visible.length - laggards.length
  const names = laggards.map((a) => a.account_id.slice(-4)).join(', ')

  return (
    <Banner tone="warn" icon="⚠️">
      {laggards.length} account{laggards.length === 1 ? '' : 's'} not reporting (…{names}) — a
      trade now would reach {reachable} of {visible.length}.
    </Banner>
  )
}

function Banner({
  tone, icon, children,
}: { tone: 'danger' | 'warn'; icon: string; children: React.ReactNode }) {
  const cls = tone === 'danger'
    ? 'bg-orange-950/70 border-orange-800/60 text-orange-200'
    : 'bg-amber-950/60 border-amber-800/50 text-amber-200'
  return (
    <div className={`${cls} border-b text-xs font-medium px-4 py-2 flex items-center justify-center gap-2 text-center`}>
      <span className="animate-pulse shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  )
}
