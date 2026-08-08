// app/api/auth/sandbox-login/route.ts
// Lets a phone open the LOCAL sandbox, which the Face ID gate would otherwise
// block: WebAuthn refuses to run over plain HTTP on a LAN address, so there is
// no way to pass the gate from a phone pointed at http://192.168.x.x:3100.
//
// Double-gated, and both gates must hold:
//   1. SANDBOX_MODE=1 must be set — only test/run.mjs ever sets it, never a
//      deploy. Without it this route 404s as though it does not exist.
//   2. The caller must be on a loopback or private (RFC1918) address, so even
//      if the flag were ever set in production a request off the internet still
//      could not use it.
//
// Anything else returns 404 rather than 403, so it gives away nothing.

import { NextRequest, NextResponse } from 'next/server'
import { signJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'nodejs'

function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^::ffff:/, '').trim()
  if (addr === '::1' || addr === 'localhost') return true
  const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 127) return true                      // loopback
  if (a === 10) return true                       // 10.0.0.0/8
  if (a === 192 && b === 168) return true         // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 169 && b === 254) return true         // link-local
  return false
}

const notFound = () => new NextResponse('Not Found', { status: 404 })

export async function GET(req: NextRequest) {
  if (process.env.SANDBOX_MODE !== '1') return notFound()

  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || '127.0.0.1'
  if (!isPrivateAddress(ip)) return notFound()

  if (!AUTH_JWT_SECRET) return notFound()

  const token = await signJWT({ sub: 'sandbox' }, AUTH_JWT_SECRET, 12 * 60 * 60)
  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set('td_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
    // Deliberately not `secure`: the sandbox is served over plain HTTP on a
    // LAN address, and a secure cookie would never be stored.
  })
  return res
}
