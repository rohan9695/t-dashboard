'use client'
// components/WebAuthnGate.tsx
// Blocks the dashboard behind Face ID / WebAuthn on every visit.
// - First visit (no credentials registered): shows registration flow
// - Subsequent visits: immediately triggers Face ID authentication
// - 5-minute idle → auto-blur + re-prompt Face ID
// - Falls back to Supabase magic link if WebAuthn unavailable

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser'

type AuthState = 'checking' | 'unauthenticated' | 'registering' | 'authenticating' | 'authenticated' | 'blurred'

const IDLE_TIMEOUT_MS = 5 * 60_000 // 5 minutes

export function WebAuthnGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [error, setError] = useState('')
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      setAuthState('blurred')
    }, IDLE_TIMEOUT_MS)
  }, [])

  useEffect(() => {
    async function init() {
      if (!browserSupportsWebAuthn()) {
        setAuthState('unauthenticated')
        return
      }

      try {
        // Check for existing valid session (td_session cookie is httpOnly — probe an auth'd route)
        const probe = await fetch('/api/heartbeat')
        if (probe.ok) {
          setAuthState('authenticated')
          resetIdleTimer()
          return
        }

        // No valid session — check whether credentials have been registered
        const checkRes = await fetch('/api/auth/check')
        if (checkRes.ok) {
          const { registered } = await checkRes.json() as { registered: boolean }
          setHasCredentials(registered)
        }

        setAuthState('unauthenticated')
      } catch {
        setAuthState('unauthenticated')
      }
    }
    init()
  }, [resetIdleTimer])

  // Reset idle timer on user activity when authenticated
  useEffect(() => {
    if (authState !== 'authenticated') return
    const events = ['click', 'touchstart', 'keydown', 'mousemove']
    events.forEach((e) => window.addEventListener(e, resetIdleTimer, { passive: true }))
    resetIdleTimer()
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [authState, resetIdleTimer])

  const handleRegister = async () => {
    setError('')
    setAuthState('registering')
    try {
      const optRes = await fetch('/api/auth/register-options', { method: 'POST' })
      const opts = await optRes.json()
      const attResp = await startRegistration(opts)
      const verRes = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attResp),
      })
      const ver = await verRes.json()
      if (ver.verified) {
        setAuthState('authenticated')
        resetIdleTimer()
      } else {
        setError(ver.error ?? 'Registration failed')
        setAuthState('unauthenticated')
      }
    } catch (e) {
      setError(String(e))
      setAuthState('unauthenticated')
    }
  }

  const handleLogin = useCallback(async () => {
    setError('')
    setAuthState('authenticating')
    try {
      const optRes = await fetch('/api/auth/login-options', { method: 'POST' })
      const opts = await optRes.json()
      const authResp = await startAuthentication(opts)
      const verRes = await fetch('/api/auth/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp),
      })
      const ver = await verRes.json()
      if (ver.verified) {
        setAuthState('authenticated')
        resetIdleTimer()
      } else {
        setError(ver.error ?? 'Authentication failed')
        setAuthState('unauthenticated')
      }
    } catch (e) {
      setError(String(e))
      setAuthState('unauthenticated')
    }
  }, [resetIdleTimer])

  // Auto-trigger login when state becomes unauthenticated and credentials exist
  useEffect(() => {
    if (authState === 'unauthenticated' && hasCredentials && browserSupportsWebAuthn()) {
      handleLogin()
    }
  }, [authState, hasCredentials, handleLogin])

  const sendMagicLink = async () => {
    if (!magicEmail) return
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: magicEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      })
      if (error) setError(error.message)
      else setMagicSent(true)
    } catch (e) {
      setError(String(e))
    }
  }

  // ── Authenticated: render children (with blur overlay when idle) ──────────
  if (authState === 'authenticated' || authState === 'blurred') {
    return (
      <div className="relative">
        <div className={authState === 'blurred' ? 'blur-sm pointer-events-none select-none' : ''}>
          {children}
        </div>

        {authState === 'blurred' && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-xl">
            <div className="flex flex-col items-center gap-6 text-center px-8">
              <div className="w-20 h-20 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-4xl">
                🔒
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-100 mb-1">Session Locked</h2>
                <p className="text-zinc-500 text-sm">Inactive for 5 minutes</p>
              </div>
              <button
                onClick={handleLogin}
                className="min-w-[200px] min-h-[44px] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
              >
                Unlock with Face ID
              </button>
              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Auth gate overlay ─────────────────────────────────────────────────────
  const isLoading = authState === 'checking' || authState === 'registering' || authState === 'authenticating'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 px-8">
      <div className="flex flex-col items-center gap-6 text-center max-w-xs w-full">
        {/* Logo */}
        <svg viewBox="0 0 44 44" fill="none" className="w-12 h-12">
          <circle cx="16" cy="22" r="11" stroke="white" strokeWidth="2.2" />
          <circle cx="28" cy="22" r="11" stroke="white" strokeWidth="2.2" />
        </svg>

        <div>
          <h1 className="text-xl font-bold text-zinc-100">Trader Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {authState === 'checking' && 'Checking credentials…'}
            {authState === 'registering' && 'Setting up Face ID…'}
            {authState === 'authenticating' && 'Verifying Face ID…'}
            {authState === 'unauthenticated' && (hasCredentials ? 'Face ID required' : 'Set up Face ID to continue')}
          </p>
        </div>

        {isLoading && (
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
        )}

        {authState === 'unauthenticated' && !hasCredentials && !isLoading && (
          <button
            onClick={handleRegister}
            className="w-full min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
          >
            Set up Face ID
          </button>
        )}

        {authState === 'unauthenticated' && hasCredentials && !isLoading && (
          <button
            onClick={handleLogin}
            className="w-full min-h-[44pt] bg-zinc-100 text-zinc-900 font-semibold rounded-xl px-6 py-3 text-sm active:scale-95 transition-transform"
          >
            Authenticate with Face ID
          </button>
        )}

        {/* Magic link fallback */}
        {authState === 'unauthenticated' && !isLoading && (
          <div className="w-full mt-2">
            <p className="text-zinc-600 text-xs mb-2">
              {!browserSupportsWebAuthn() ? 'Face ID not available on this device.' : 'Face ID not working?'}
            </p>
            {!magicSent ? (
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 min-h-[44pt]"
                />
                <button
                  onClick={sendMagicLink}
                  className="bg-zinc-700 text-zinc-100 rounded-lg px-4 py-2 text-sm min-h-[44pt]"
                >
                  Send link
                </button>
              </div>
            ) : (
              <p className="text-emerald-400 text-sm">Magic link sent — check your email</p>
            )}
          </div>
        )}

        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </div>
    </div>
  )
}
