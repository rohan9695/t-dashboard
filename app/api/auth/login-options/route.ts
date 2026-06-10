// app/api/auth/login-options/route.ts
// WebAuthn: generate authentication (login) options.
// We omit allowCredentials — since registration uses residentKey:'preferred',
// the browser surfaces stored passkeys automatically without needing to be told.

import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { signJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'nodejs'

const RP_ID = process.env.WEBAUTHN_RP_ID ?? 't-dashboard-pi.vercel.app'

export async function POST(_req: NextRequest) {
  if (!AUTH_JWT_SECRET) {
    return NextResponse.json(
      { error: 'Server auth secret is not configured. Set JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY in Vercel.' },
      { status: 500 },
    )
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    // allowCredentials intentionally omitted: discoverable credential flow
  })

  const challengeToken = await signJWT(
    { challenge: options.challenge },
    AUTH_JWT_SECRET,
    300,
  )

  const res = NextResponse.json(options)
  res.cookies.set('td_challenge', challengeToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 300,
    path: '/',
  })
  return res
}
