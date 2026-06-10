// app/auth/confirm/route.ts
// Handles Supabase magic-link callbacks.
// Supabase redirects here after the user clicks the email link:
//   /auth/confirm?token_hash=<hash>&type=email
// We verify the OTP with Supabase, then issue our own td_session JWT cookie
// so the rest of the app sees the user as authenticated.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { signJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'

export const runtime = 'nodejs'

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      ?? 'https://gvbtnsktudmgmpamkhnl.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YnRuc2t0dWRtZ21wYW1raG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjQ5MjQsImV4cCI6MjA5NTkwMDkyNH0.9K4KcZVEosgpJWK0uqeswVIK-bDfE1SpUgZouPAa3zo'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const token_hash = searchParams.get('token_hash')
  const type       = (searchParams.get('type') ?? 'email') as 'email' | 'magiclink' | 'signup' | 'recovery'
  const origin     = req.nextUrl.origin

  if (!token_hash) {
    return NextResponse.redirect(new URL('/', origin))
  }

  if (!AUTH_JWT_SECRET) {
    // Can't issue a session — redirect home and let the gate show an error
    return NextResponse.redirect(new URL('/', origin))
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })

    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })

    if (error || !data.user) {
      return NextResponse.redirect(new URL('/', origin))
    }

    // Magic link verified — issue our standard 24-hour session cookie
    const sessionToken = await signJWT({ authed: true }, AUTH_JWT_SECRET, 86_400)

    const response = NextResponse.redirect(new URL('/', origin))
    response.cookies.set('td_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 86_400,
      path: '/',
    })
    return response
  } catch {
    return NextResponse.redirect(new URL('/', origin))
  }
}
