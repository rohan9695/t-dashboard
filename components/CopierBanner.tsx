'use client'
// components/CopierBanner.tsx
// "Replikanto did not copy" banner.
//
// The failure this catches: the leader account fills, the copier does not
// replicate, and the follower accounts sit flat. Nothing in the dashboard
// showed that before — the leader simply had a position and the others did
// not, which looks identical to a normal quiet account.
//
// Detection needs no new data. If the leader is holding an open position and a
// live follower is flat, the copy did not happen. The comparison is only made
// after a grace period, because a fill legitimately takes a moment to
// propagate, and only against followers that are actually online — an offline
// account was never going to fill.
//
// DEPENDS ON open P&L being reported. dollar_open is fed by NT8's
// UnrealizedProfitLoss / DollarOpen items; if the addon does not subscribe to
// them every account reads flat and this can never fire. `/api/data` shows
// which fields NT8 actually sends, per account, in nt_fields.

import { useEffect, useRef, useState } from 'react'
import { useRealtime } from './RealtimeProvider'

// A copied order should land well inside this. Long enough not to cry wolf on
// normal propagation, short enough to matter while the trade is still open.
const GRACE_MS = 45_000
// Matches AccountsGrid: past this an account is offline and not expected to fill.
const OFFLINE_MS = 30 * 60_000

export function CopierBanner() {
  const { accounts } = useRealtime()
  const [, tick] = useState(0)
  // When the leader's current position was first seen. Reset when it closes.
  const openedAt = useRef<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const visible = accounts.filter((a) => !a.hidden)
  const leader = visible.find((a) => a.replikanto_role === 'leader')

  const leaderOpen = leader ? (leader.dollar_open ?? 0) !== 0 : false

  // Track how long the leader has held this position.
  if (!leaderOpen) {
    openedAt.current = null
  } else if (openedAt.current === null) {
    openedAt.current = Date.now()
  }

  if (!leader || !leaderOpen || openedAt.current === null) return null
  if (Date.now() - openedAt.current < GRACE_MS) return null

  const now = Date.now()
  const followers = visible.filter(
    (a) =>
      a.account_id !== leader.account_id &&
      now - new Date(a.last_update).getTime() <= OFFLINE_MS,
  )
  if (followers.length === 0) return null

  const flat = followers.filter((a) => (a.dollar_open ?? 0) === 0)
  if (flat.length === 0) return null

  return (
    <div className="bg-orange-950/70 border-b border-orange-800/60 text-orange-200 text-xs font-medium px-4 py-2 flex items-center justify-center gap-2 text-center">
      <span className="animate-pulse shrink-0">🔁</span>
      <span>
        Replikanto not copying — leader is in a position, {flat.length} of{' '}
        {followers.length} account{followers.length === 1 ? '' : 's'} still flat.
      </span>
    </div>
  )
}
