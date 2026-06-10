// app/api/auth/check/route.ts
// Open endpoint: returns whether any passkey credentials have been registered.
// Used by WebAuthnGate to decide whether to show "Register" vs "Authenticate".
// No auth required — it reveals nothing sensitive (just a boolean count).

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('passkey_credentials')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ registered: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ registered: (count ?? 0) > 0 })
}
