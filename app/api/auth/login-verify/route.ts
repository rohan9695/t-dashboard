// app/api/auth/login-verify/route.ts
// WebAuthn: verify authentication response and issue session cookie.

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyJWT, signJWT } from '@/lib/jwt'

export const runtime = 'nodejs'

const RP_ID      = process.env.WEBAUTHN_RP_ID ?? 't-dashboard-pi.vercel.app'
const ORIGIN     = process.env.WEBAUTHN_ORIGIN ?? 'https://t-dashboard-pi.vercel.app'
const JWT_SECRET = process.env.JWT_SECRET ?? ''

function b64urlToUint8Array(b64url: string): Uint8Array {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(Buffer.from(base64 + pad, 'base64'))
}

export async function POST(req: NextRequest) {
  const challengeToken = req.cookies.get('td_challenge')?.value
  if (!challengeToken || !JWT_SECRET) {
    return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  }

  const challengePayload = await verifyJWT(challengeToken, JWT_SECRET)
  if (!challengePayload || typeof challengePayload.challenge !== 'string') {
    return NextResponse.json({ error: 'Challenge expired or invalid' }, { status: 400 })
  }

  let body: AuthenticationResponseJSON
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Look up the credential by ID
  const { data: credRow } = await supabase
    .from('passkey_credentials')
    .select('*')
    .eq('credential_id', body.id)
    .single()

  if (!credRow) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID:        b64urlToUint8Array(credRow.credential_id as string),
        credentialPublicKey: Uint8Array.from(Buffer.from(credRow.public_key as string, 'base64')),
        counter:             credRow.counter as number,
        transports:          (credRow.transports ?? []) as AuthenticatorTransport[],
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
  }

  // Update counter to prevent replay attacks
  await supabase
    .from('passkey_credentials')
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq('credential_id', body.id)

  // Issue 24-hour session
  const sessionToken = await signJWT({ authed: true }, JWT_SECRET, 86_400)

  const res = NextResponse.json({ verified: true })
  res.cookies.set('td_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 86_400,
    path: '/',
  })
  res.cookies.delete('td_challenge')
  return res
}
