// middleware.ts
// Task 2A: API authentication + access logging.
//
// Every /api/* request must pass ONE of:
//   1. Authorization: Bearer <API_SECRET_TOKEN>   ← new standard
//   2. X-Api-Key: <API_KEY>                       ← legacy NT8 addon compat
//   3. Cookie: td_session=<signed JWT>             ← browser after Face ID
//
// Exclusions (handled separately):
//   /api/auth/*          – WebAuthn registration/login (unauthenticated)
//   /api/killswitch*     – has its own KILLSWITCH_TOKEN
//   /api/set-leader      – dashboard control, unauthenticated (see route file)
//   /api/heartbeat       – keep-warm function uses Bearer above
//
// Access logging: every hit is written async to access_logs.
// Failed auth alerting: 3 bad attempts from same IP in 5 min → Resend email.

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

const API_SECRET_TOKEN = process.env.API_SECRET_TOKEN ?? ''
const API_KEY          = process.env.API_KEY ?? ''
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const RESEND_API_KEY   = process.env.RESEND_API_KEY ?? ''
const ALERT_EMAIL      = process.env.ALERT_EMAIL ?? ''

// Routes that bypass this middleware's auth (they have their own)
const OPEN_PREFIXES = [
  '/api/auth/',
  '/api/killswitch',
  '/api/set-leader', // dashboard-only control, matches the dashboard's current unauthenticated posture
]

async function isKillswitchActive(): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?key=eq.killswitch&select=value&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    )
    if (!res.ok) return false
    const rows = (await res.json()) as Array<{ value: string }>
    return rows[0]?.value === 'true'
  } catch {
    return false
  }
}

function isOpen(pathname: string): boolean {
  return OPEN_PREFIXES.some((p) => pathname.startsWith(p))
}

async function logAccess(
  ip: string,
  route: string,
  method: string,
  success: boolean,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  // Fire-and-forget — never block the request
  fetch(`${SUPABASE_URL}/rest/v1/access_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ip, route, method, success }),
  }).catch(() => { /* non-critical */ })
}

// Check whether IP has 3 failures in last 5 minutes and send alert
async function maybeAlert(ip: string, route: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY || !ALERT_EMAIL) return
  try {
    const since = new Date(Date.now() - 5 * 60_000).toISOString()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/access_logs?ip=eq.${encodeURIComponent(ip)}&success=eq.false&created_at=gte.${since}&select=id`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    )
    if (!res.ok) return
    const rows = (await res.json()) as unknown[]
    if (rows.length >= 3) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'alerts@resend.dev',
          to: ALERT_EMAIL,
          subject: `🚨 Trader Dashboard: 3 failed auth attempts from ${ip}`,
          html: `<p>IP <strong>${ip}</strong> made 3+ failed authentication attempts in the last 5 minutes.</p>
                 <p>Last attempted route: ${route}</p>
                 <p>Time: ${new Date().toISOString()}</p>`,
        }),
      })
    }
  } catch { /* non-critical */ }
}

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  // 1. Bearer token
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ') && API_SECRET_TOKEN) {
    if (auth.slice(7) === API_SECRET_TOKEN) return true
  }

  // 2. Legacy X-Api-Key (NT8 addon backward compat)
  const xKey = req.headers.get('x-api-key') ?? req.headers.get('X-Api-Key') ?? ''
  if (xKey && API_KEY && xKey === API_KEY) return true

  // 3. Session cookie (browser after Face ID auth)
  const sessionCookie = req.cookies.get('td_session')?.value
  if (sessionCookie && AUTH_JWT_SECRET) {
    const payload = await verifyJWT(sessionCookie, AUTH_JWT_SECRET)
    if (payload) return true
  }

  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // Skip auth for open routes
  if (isOpen(pathname)) {
    return NextResponse.next()
  }

  // Only gate /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Killswitch: return 503 for all /api/* except killswitch routes
  const killed = await isKillswitchActive()
  if (killed) {
    return NextResponse.json(
      { error: 'Service disabled', killswitch: true },
      { status: 503 },
    )
  }

  const authed = await isAuthenticated(req)

  // Log every /api/* hit (async — never blocks response)
  logAccess(ip, pathname, req.method, authed)

  if (!authed) {
    // Kick off alert check in background
    maybeAlert(ip, pathname)

    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
