// app/api/auth/register-verify/route.ts
// WebAuthn: verify registration response and persist credential to Supabase.

import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyJWT, signJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'nodejs'

const RP_ID  = process.env.WEBAUTHN_RP_ID ?? 't-dashboard-pi.vercel.app'
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? 'https://t-dashboard-pi.vercel.app'

export async function POST(req: NextRequest) {
  const challengeToken = req.cookies.get('td_challenge')?.value
  if (!challengeToken || !AUTH_JWT_SECRET) {
    return NextResponse.json({ error: 'Missing challenge' }, { status: 400 })
  }

  const challengePayload = await verifyJWT(challengeToken, AUTH_JWT_SECRET)
  if (!challengePayload || typeof challengePayload.challenge !== 'string') {
    return NextResponse.json({ error: 'Challenge expired or invalid' }, { status: 400 })
  }

  let body: RegistrationResponseJSON
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengePayload.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
  }

  const {
    credentialID,
    credentialPublicKey,
    counter,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo

  const supabase = createServiceClient()
  const { error } = await supabase.from('passkey_credentials').insert({
    credential_id: Buffer.from(credentialID).toString('base64url'),
    public_key:    Buffer.from(credentialPublicKey).toString('base64'),
    counter,
    device_type:   credentialDeviceType,
    backed_up:     credentialBackedUp,
    transports:    body.response.transports ?? [],
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sessionToken = await signJWT({ authed: true }, AUTH_JWT_SECRET, 86_400)

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
