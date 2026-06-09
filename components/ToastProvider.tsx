'use client'
// components/ToastProvider.tsx
// Small pill toasts at bottom-center, stacked upward, auto-dismiss after 3s.
// Triggered by Supabase Realtime inserts on the trade_events table.
// Deduplicates same event within 5 minutes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createClient } from '@/lib/supabase/client'

interface Toast {
  id: string
  message: string
  ts: number
}

interface ToastCtx {
  push: (message: string) => void
}

const Ctx = createContext<ToastCtx>({ push: () => {} })
export function useToast() { return useContext(Ctx) }

// Key for deduplication: message → last shown timestamp
const recentMessages = new Map<string, number>()
const DEDUP_MS = 5 * 60_000 // 5 minutes

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const supabaseRef = useRef(createClient())

  const push = useCallback((message: string) => {
    const now = Date.now()
    const last = recentMessages.get(message) ?? 0
    if (now - last < DEDUP_MS) return // deduplicate

    recentMessages.set(message, now)

    const id = `${now}-${Math.random()}`
    setToasts((prev) => [...prev.slice(-2), { id, message, ts: now }]) // max 3

    // Haptic
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(50)
    }

    // Auto-dismiss after 3s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3_000)
  }, [])

  // 1.5s aggregation window for multi-account fills
  const pendingFillsRef = useRef<{
    symbol: string
    direction: string
    accounts: string[]
    totalAccounts: number
    ts: number
    timerSet: boolean
  } | null>(null)

  function flushFill() {
    const p = pendingFillsRef.current
    if (!p) return
    pendingFillsRef.current = null

    const { symbol, direction, accounts, totalAccounts } = p
    const count = accounts.length
    const emoji = direction === 'long' ? '✅' : direction === 'short' ? '⚠️' : '💰'

    if (count < totalAccounts && totalAccounts > 1) {
      push(`🚨 ${symbol} ${direction} · ${count} account${count > 1 ? 's' : ''} only`)
    } else {
      push(`${emoji} ${symbol} ${direction} · ${count} account${count > 1 ? 's' : ''}`)
    }
  }

  useEffect(() => {
    const supabase = supabaseRef.current

    const channel = supabase
      .channel('trade-events-toasts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_events' },
        (payload) => {
          const ev = payload.new as Record<string, unknown>
          const symbol    = String(ev.symbol ?? 'ES')
          const direction = String(ev.direction ?? '')
          const accountId = String(ev.account_id ?? '')
          const totalAcc  = Number(ev.total_accounts ?? 1)
          const pnl       = ev.pnl ? Number(ev.pnl) : null

          // Closed trade
          if (ev.event_type === 'close' && pnl !== null) {
            const sign = pnl >= 0 ? '+' : ''
            push(`💰 ${sign}$${Math.round(pnl)} · ${symbol} closed`)
            return
          }

          // Open trade — aggregate for 1.5s
          const now = Date.now()
          const p = pendingFillsRef.current
          if (p && p.symbol === symbol && p.direction === direction && now - p.ts < 1_500) {
            p.accounts.push(accountId)
          } else {
            pendingFillsRef.current = {
              symbol, direction, accounts: [accountId],
              totalAccounts: totalAcc, ts: now, timerSet: false,
            }
          }

          if (pendingFillsRef.current && !pendingFillsRef.current.timerSet) {
            pendingFillsRef.current.timerSet = true
            setTimeout(flushFill, 1_500)
          }
        },
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [push]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ push }}>
      {children}

      {/* Toast stack — bottom-center, above iPhone home indicator */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col-reverse items-center gap-2 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="max-w-[200px] bg-zinc-800/90 backdrop-blur-sm border border-zinc-700/60 text-zinc-100 text-[13px] leading-tight font-medium px-4 py-2 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 whitespace-nowrap overflow-hidden text-ellipsis"
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  )
}
