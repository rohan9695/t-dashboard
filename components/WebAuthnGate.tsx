'use client'
// components/WebAuthnGate.tsx
// Blocks the dashboard behind Face ID / WebAuthn.
//
// Design rule: WebAuthn is NEVER triggered automatically. Browsers (Safari/PWA
// especially) will silently no-op a startAuthentication() call that isn't the
// direct result of a user tap — that's what made Face ID "just not show up"
// before. Every call here happens inside an onClick handler, no exceptions.
//
// Session lasts 24h (the session cookie's natural expiry, set server-side) —
// no idle-timeout blur/re-prompt loop. Log out manually if you want to lock
// it sooner.

import { useCallback, useEffect, useState } from 'react'
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser'

type GateState = 'checking' | 'locked' | 'busy' | 'authenticated' | 'unsupported'

export function WebAuthnGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [error, setError] = useState('')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [showRegisterFallback, setShowRegisterFallback] = useState(false)

  // Silent on load: check for an existing session and whether a passkey is
  // already registered. Never calls WebAuthn here — no user gesture yet.
  useEffect(() => {
    async function init() {
      if (!browserSupportsWebAuthn()) {
        setState('unsupported')
        return
      }
      try {
        const sessionProbe = await fetch('/api/heartbeat')
        if (sessionProbe.ok) {
          setState('authenticated')
          return
        }
      } catch { /* fall through to locked */ }

      try {
        const checkRes = await fetch('/api/auth/check')
        if (checkRes.ok) {
          const { registered } = (await checkRes.json()) as { registered: boolean }
          setHasCredentials(registered)
        }
      } catch { /* default hasCredentials = false */ }

      setState('locked')
    }
    init()
  }, [])

  const handleLogin = useCallback(async () => {
    setError('')
    setState('busy')
    try {
      const optRes = await fetch('/api/auth/login-options', { method: 'POST' })
      const opts = await optRes.json()
      if (!optRes.ok) throw new Error((opts as { error?: string }).error ?? 'Failed to start Face ID')

      const authResp = await startAuthentication(opts)

      const verRes = await fetch('/api/auth/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp),
      })
      const ver = await verRes.json()
      if (ver.verified) {
        setState('authenticated')
      } else {
        setError(ver.error ?? 'Face ID did not match — try registering a new passkey below')
        setShowRegisterFallback(true)
        setState('locked')
      }
    } catch (e) {
      // User cancelled, or no matching passkey for this domain
      setError('Face ID was cancelled or unavailable — try registering a new passkey below')
      setShowRegisterFallback(true)
      setState('locked')
    }
  }, [])

  const handleRegister = useCallback(async () => {
    setError('')
    setState('busy')
    try {
      const optRes = await fetch('/api/auth/register-options', { method: 'POST' })
      const opts = await optRes.json()
      if (!optRes.ok) throw new Error((opts as { error?: string }).error ?? 'Failed to start setup')

      const attResp = await startRegistration(opts)

      const verRes = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attResp),
      })
      const ver = await verRes.json()
      if (ver.verified) {
        setState('authenticated')
      } else {
        setError(ver.error ?? 'Setup failed')
        setState('locked')
      }
    } catch (e) {
      setError(String(e))
      setState('locked')
    }
  }, [])

  if (state === 'authenticated') {
    return <>{children}</>
  }

  if (state === 'checking') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 px-8">
      <div className="flex flex-col items-center gap-6 text-center max-w-xs w-full">
        <svg viewBox="0 0 44 44" fill="none" className="w-12 h-12">
          <circle cx="16" cy="22" r="11" stroke="white" strokeWidth="2.2" />
          <circle cx="28" cy="22" r="11" stroke="white" strokeWidth="2.2" />
        </svg>

        <div>
          <h1 className="text-xl font-bold text-zinc-100">Trader Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {state === 'unsupported' && 'Face ID / Touch ID is not available on this device.'}
            {state === 'busy' && 'Waiting for Face ID…'}
            {state === 'locked' && (hasCredentials ? 'Tap to unlock' : 'Set up Face ID to continue')}
          </p>
        </div>

        {state === 'busy' && (
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
        )}

        {state === 'locked' && hasCredentials && !showRegisterFallback && (
          <button
            onClick={handleLogin}
            className="w-full min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
          >
            Unlock with Face ID
          </button>
        )}

        {state === 'locked' && (!hasCredentials || showRegisterFallback) && (
          <button
            onClick={handleRegister}
            className="w-full min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
          >
            {hasCredentials ? 'Register a new passkey' : 'Set up Face ID'}
          </button>
        )}

        {state === 'locked' && showRegisterFallback && (
          <button
            onClick={handleLogin}
            className="text-zinc-500 text-xs underline"
          >
            Try Face ID again instead
          </button>
        )}

        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </div>
    </div>
  )
}
