// app/api/killswitch/status/route.ts
// GET /api/killswitch/status — check killswitch state (requires KILLSWITCH_TOKEN)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'


const KILLSWITCH_TOKEN = process.env.KILLSWITCH_TOKEN ?? ''

function checkToken(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${KILLSWITCH_TOKEN}` && KILLSWITCH_TOKEN !== ''
}

export async function GET(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', 'killswitch')
    .single()

  const active = data?.value === 'true'
  return NextResponse.json({
    killswitch: active,
    updated_at: data?.updated_at ?? null,
  })
}
