'use client'
// components/GroupedSummary.tsx
// Read-only "daily summary" view: one hero P&L number, then accounts grouped by
// name prefix, each group expandable. Reads the rows RealtimeProvider already
// holds — it issues no queries of its own and writes nothing.

import { useEffect, useState } from 'react'
import { useRealtime } from './RealtimeProvider'
import { useVisibility } from './VisibilityProvider'
import {
  summarize, sortByPnl, dayPnl, shortId,
  formatSigned as fmtSigned, formatBalance as fmtBalance,
} from '@/lib/account-groups'
import { cardBlob } from '@/lib/summary-card'
import { offlineThresholdMs } from '@/lib/freshness'
import type { AccountRow } from '@/lib/trading-logic'

const HIDDEN = '••••••'
const PREFS_KEY = 'td_summary_prefs'

function tone(v: number) {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-zinc-400'
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

const chip =
  'px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-[11px] font-medium active:bg-zinc-700 transition-colors min-h-[32px]'

export function GroupedSummary() {
  const { accounts, loading, lastSync } = useRealtime()
  const { visible, toggle } = useVisibility()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [byPnl, setByPnl] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  // Remember which groups were open and the sort — per device, never sent anywhere.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (raw) {
        const p = JSON.parse(raw) as { open?: Record<string, boolean>; byPnl?: boolean }
        if (p.open && typeof p.open === 'object') setOpen(p.open)
        if (typeof p.byPnl === 'boolean') setByPnl(p.byPnl)
      }
    } catch { /* corrupt or blocked storage — start from defaults */ }
    setPrefsLoaded(true)
  }, [])

  useEffect(() => {
    if (!prefsLoaded) return
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ open, byPnl })) } catch { /* optional */ }
  }, [open, byPnl, prefsLoaded])

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview) }
  }, [preview])

  // Same population as the main dashboard: hidden accounts (NT8 no longer
  // reports them) are out, everything else counts — breached and offline
  // accounts still hold money and still have P&L.
  const shown = accounts.filter((a) => !a.hidden)
  const offline = (r: AccountRow) => now - new Date(r.last_update).getTime() > offlineThresholdMs(r)
  const base = summarize(shown, offline)
  const groups = byPnl ? sortByPnl(base) : base

  const totalPnl = groups.reduce((s, g) => s + g.pnl, 0)
  const totalRealized = groups.reduce((s, g) => s + g.realized, 0)
  const totalOpen = groups.reduce((s, g) => s + g.open, 0)
  const totalBalance = groups.reduce((s, g) => s + g.balance, 0)
  const totalUp = groups.reduce((s, g) => s + g.up, 0)
  const totalDown = groups.reduce((s, g) => s + g.down, 0)
  const totalFlat = groups.reduce((s, g) => s + g.flat, 0)
  const leader = shown.find((a) => a.replikanto_role === 'leader')

  if (loading && shown.length === 0) {
    return <p className="text-center text-zinc-600 text-sm py-20">Loading…</p>
  }

  if (shown.length === 0) {
    return <p className="text-center text-zinc-500 text-sm py-20">No accounts connected</p>
  }

  const allOpen = groups.every((g) => open[g.group.key])
  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(groups.map((g) => [g.group.key, value])))

  const stamp = lastSync
    ? lastSync.toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : null

  // Builds the share image from what is on screen right now. Uses the native
  // share sheet when the browser can share files (iPhone: straight to Photos or
  // Messages); otherwise shows the image so it can be pressed-and-held to save.
  // Cancelling the share sheet is not an error. Anything else is reported — a
  // button that silently does nothing is worse than one that says it failed.
  async function shareCard() {
    if (sharing) return
    setSharing(true)
    setShareError(null)
    try {
      const blob = await cardBlob({
        pnl: totalPnl,
        accounts: shown.length,
        balance: visible ? fmtBalance(totalBalance) : null,
        groups: groups.map((g) => ({ label: g.group.label, count: g.rows.length, pnl: g.pnl })),
        stamp,
      })
      const file = new File([blob], 'daily-pnl.png', { type: 'image/png' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Daily P&L' })
          return
        } catch (e) {
          // Closing the share sheet is a choice, not a failure. Any other
          // rejection falls through to showing the image instead.
          if ((e as Error)?.name === 'AbortError') return
        }
      }
      setPreview(URL.createObjectURL(blob))
    } catch {
      setShareError('Could not create the image. Try again.')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 relative">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Daily P&amp;L</p>
          <button
            onClick={toggle}
            aria-label={visible ? 'Hide balances' : 'Show balances'}
            className="-mt-2 -mr-2 p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
              {visible ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              ) : (
                <>
                  <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </div>

        <p
          data-testid="daily-pnl"
          className={`font-mono font-bold tracking-tight text-4xl sm:text-5xl ${tone(totalPnl)}`}
        >
          {fmtSigned(totalPnl)}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
          <span className="text-zinc-500">
            Realized <span data-testid="realized" className={tone(totalRealized)}>{fmtSigned(totalRealized)}</span>
          </span>
          <span className="text-zinc-500">
            Open <span data-testid="open" className={tone(totalOpen)}>{fmtSigned(totalOpen)}</span>
          </span>
          {leader && (
            <span className="text-zinc-500">
              Leader <span data-testid="leader-pnl" className={tone(dayPnl(leader))}>{fmtSigned(dayPnl(leader))}</span>
            </span>
          )}
        </div>

        <div className="mt-5 space-y-1 text-[11px] uppercase tracking-widest text-zinc-500">
          <p>
            Total balance · <span className="text-zinc-200 font-semibold normal-case tracking-normal">
              {visible ? fmtBalance(totalBalance) : HIDDEN}
            </span>
          </p>
          <p>
            Across <span className="text-zinc-200 font-semibold">{shown.length}</span> accounts
            <span data-testid="tally" className="normal-case tracking-normal ml-2 text-zinc-500">
              <span className="text-emerald-400">{totalUp} up</span> · <span className="text-red-400">{totalDown} down</span> · {totalFlat} flat
            </span>
          </p>
          {stamp && <p className="normal-case tracking-normal text-zinc-600 text-[11px]">Updated {stamp}</p>}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setAll(!allOpen)} className={chip}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <button onClick={shareCard} disabled={sharing} className={`${chip} disabled:opacity-60`}>
          {sharing ? 'Creating…' : 'Share card'}
        </button>
        <button onClick={() => setByPnl((v) => !v)} className={chip} aria-pressed={byPnl}>
          {byPnl ? 'Sorted by P&L' : 'Sort by P&L'}
        </button>
      </div>
      {shareError && (
        <p role="alert" className="text-xs text-amber-400 text-center">{shareError}</p>
      )}

      {preview && (
        <div
          role="dialog"
          aria-label="Daily P&L image"
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-3 p-4"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Daily P&L summary" className="max-h-[78vh] max-w-full rounded-xl" />
          <p className="text-xs text-zinc-300">Press and hold the image to save it. Tap anywhere to close.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {groups.map((g) => {
          const isOpen = !!open[g.group.key]
          const panelId = `group-${g.group.key}`
          const silent = g.rows.length - g.reporting
          return (
            <div key={g.group.key} className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.group.key]: !o[g.group.key] }))}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-zinc-800/60 hover:bg-zinc-800/40 transition-colors"
              >
                <Chevron open={isOpen} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold uppercase tracking-wide text-zinc-100 truncate">
                    {g.group.label}
                  </span>
                  <span className="block text-[11px] text-zinc-500">
                    {g.rows.length} {g.rows.length === 1 ? 'acct' : 'accts'}
                    {' · '}
                    <span className="text-emerald-500/80">{g.up}↑</span>{' '}
                    <span className="text-red-400/80">{g.down}↓</span>{' '}
                    {g.flat}–
                    {silent > 0 && (
                      <span data-testid={`silent-${g.group.key}`} className="text-amber-400">
                        {' · '}{g.reporting}/{g.rows.length} reporting
                      </span>
                    )}
                  </span>
                </span>
                <span
                  data-testid={`group-pnl-${g.group.key}`}
                  className={`font-mono font-semibold text-base ${tone(g.pnl)}`}
                >
                  {fmtSigned(g.pnl)}
                </span>
              </button>

              {isOpen && (
                <div id={panelId} className="border-t border-zinc-800">
                  {g.rows.length > 1 && g.best && g.worst && (
                    <p className="px-4 py-2 text-[11px] text-zinc-500 border-b border-zinc-800/70">
                      Best <span className="font-mono text-zinc-300">{shortId(g.best.account_id)}</span>{' '}
                      <span className={`font-mono ${tone(g.best.pnl)}`}>{fmtSigned(g.best.pnl)}</span>
                      {' · '}
                      Worst <span className="font-mono text-zinc-300">{shortId(g.worst.account_id)}</span>{' '}
                      <span className={`font-mono ${tone(g.worst.pnl)}`}>{fmtSigned(g.worst.pnl)}</span>
                    </p>
                  )}
                  <div className="divide-y divide-zinc-800/70">
                    {[...g.rows]
                      .sort((a, b) => a.account_id.localeCompare(b.account_id))
                      .map((r) => {
                        const pnl = dayPnl(r)
                        const off = offline(r)
                        return (
                          <div
                            key={r.account_id}
                            className={`flex items-center gap-3 px-4 py-2.5 ${off ? 'opacity-50' : ''}`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${off ? 'bg-zinc-600' : 'bg-emerald-400'}`}
                              title={off ? 'Not reporting' : 'Reporting'}
                            />
                            <span className="flex-1 min-w-0 font-mono text-xs text-zinc-300 truncate">
                              {r.account_id}
                              {r.replikanto_role === 'leader' && (
                                <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-violet-900/60 text-violet-300 border border-violet-700/50">
                                  Leader
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-xs text-zinc-500 tabular-nums">
                              {visible ? fmtBalance(r.total_available) : HIDDEN}
                            </span>
                            <span className={`font-mono text-xs font-semibold tabular-nums w-24 text-right ${tone(pnl)}`}>
                              {fmtSigned(pnl)}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
