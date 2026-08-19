'use client'
// components/CopierBanner.tsx
// Two copier problems, one banner, worst-first.
//
// A third check — surfacing replikanto_status === 'off' directly — was live
// for part of 2026-08-14 and is DISABLED as of the same day. Proven wrong in
// the field: NT8's reader found a live Replikanto.InternetNode and correctly
// read its Status as "off", but a real trade copied to both accounts in that
// exact state. InternetNode most likely reflects Replikanto's connection to
// its own cloud/licensing service, not the local leader→follower copy path —
// a different thing that happened to share a name that sounded right.
// replikanto_status is still stored (harmless, and the row shows the raw
// value if inspected directly), just not surfaced as an alarm. Re-enabling
// this needs the search widened to SlaveAccount (Connected bool,
// FollowerAccountStatus Status — probed and visibly more relevant to "is
// THIS follower actually receiving copies") and confirmed against another
// real trade before it's trusted again. Per this file's own standing rule:
// a confident wrong answer is worse than no answer, so this stays off until
// verified, not just re-guessed.
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
// A hidden account last seen within this window counts as MISSING; older than
// this and it is treated as retired. hidden rows are never hard-deleted, so
// without a bound an account pulled from NT8 months ago would warn forever.
const RETIRED_MS = 12 * 60 * 60_000

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

  const leader = visible.find((a) => a.replikanto_role === 'leader')
  const now = Date.now()
  const stamp = (a: { last_update: string }) => new Date(a.last_update).getTime()

  // ── 1. Not copying ────────────────────────────────────────────────────────
  // Needs at least two visible accounts — there is nothing to copy between
  // otherwise. The readiness check below deliberately does NOT share this
  // guard; see the note there.
  const leaderOpen = leader ? (leader.dollar_open ?? 0) !== 0 : false
  if (!leaderOpen) openedAt.current = null
  else if (openedAt.current === null) openedAt.current = now

  if (visible.length >= 2 && leader && leaderOpen && openedAt.current !== null && now - openedAt.current >= GRACE_MS) {
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

  // A hidden account is one sync-accounts stopped seeing in NT8's live list —
  // which is exactly what this warning exists to report. Filtering hidden rows
  // out before counting made the check blind to its own case: the accounts
  // that vanished were removed from the comparison, and if only one was left
  // the old `visible.length < 2` guard disabled the banner outright. The
  // dashboard could show a confident green "1" with four accounts
  // unaccounted for. Missing is worse than late, not exempt.
  //
  // Note this is about accounts NT8 stopped listing, whatever the reason.
  // Deliberately closing an account looks identical here, which is why
  // RETIRED_MS exists — see above.
  //
  // A BLOWN account is the one case we can identify rather than wait out. It
  // is hidden because the prop firm liquidated it, not because a link dropped,
  // and it is never coming back — so "a trade now would reach 1 of 2" is not a
  // problem to fix, it is a fact about an account that no longer exists, and
  // the old 12-hour retirement window meant it said so for the rest of the
  // trading day. Its last stored status is the evidence: batch-update writes
  // 'breached' the moment NT8 reports the equity gone, before sync-accounts
  // gets around to hiding the row.
  const missing = accounts.filter(
    (a) => a.hidden && a.status !== 'breached' && newest - stamp(a) <= RETIRED_MS,
  )
  const laggards = visible.filter((a) => newest - stamp(a) > LAG_MS)
  const gone = [...missing, ...laggards]
  if (gone.length === 0) return null

  const total = visible.length + missing.length
  const reachable = total - gone.length
  const names = gone.map((a) => a.account_id.slice(-4)).join(', ')

  return (
    <Banner tone="warn" icon="⚠️">
      {gone.length} account{gone.length === 1 ? '' : 's'} not reporting (…{names}) — a
      trade now would reach {reachable} of {total}.
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
