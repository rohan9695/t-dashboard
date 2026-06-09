// app/api/auth/register-options/route.ts
// WebAuthn: generate registration options and store challenge in signed cookie.
// This route is intentionally open (excluded from middleware) so the browser
// can start registration before any session exists.

import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { signJWT } from '@/lib/jwt'

export const runtime = 'nodejs' // @simplewebauthn/server uses Node crypto

const RP_ID      = process.env.WEBAUTHN_RP_ID ?? 't-dashboard-pi.vercel.app'
const RP_NAME    = process.env.WEBAUTHN_RP_NAME ?? 'Trader Dashboard'
const JWT_SECRET = process.env.JWT_SECRET ?? ''

export async function POST(_req: NextRequest) {
  // Single-owner dashboard — excludeCredentials omitted (no need to deduplicate)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: 'trader-owner',
    userName: 'trader',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required', // Forces Face ID / biometric
    },
  })

  // Store challenge in a short-lived signed cookie (avoids server-side KV)
  const challengeToken = await signJWT(
    { challenge: options.challenge },
    JWT_SECRET,
    300, // 5-minute window for user to complete Face ID
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
