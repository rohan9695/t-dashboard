// app/api/auth/register-options/route.ts
// WebAuthn: generate registration options and store challenge in signed cookie.
// This route is intentionally open (excluded from middleware) so the browser
// can start registration before any session exists.

import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { signJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'nodejs' // @simplewebauthn/server uses Node crypto

const RP_ID   = process.env.WEBAUTHN_RP_ID ?? 't-dashboard.rohan9695.workers.dev'
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? 'Trader Dashboard'

export async function POST(_req: NextRequest) {
  if (!AUTH_JWT_SECRET) {
    return NextResponse.json(
      { error: 'Server auth secret is not configured. Set JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY in Vercel.' },
      { status: 500 },
    )
  }

  // Single-owner dashboard — excludeCredentials omitted (no need to deduplicate)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: 'trader-owner',
    userName: 'trader',
    attestationType: 'none',
    authenticatorSelection: {
      // platform = Face ID/Touch ID only. Without this, iOS offers "Scan QR
      // Code" / security-key / another-device options too, since it treats
      // cross-device passkeys as valid by default.
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
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
