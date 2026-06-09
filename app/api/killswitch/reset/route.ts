// app/api/killswitch/reset/route.ts
// POST /api/killswitch/reset — deactivate killswitch (requires KILLSWITCH_TOKEN)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'edge'

const KILLSWITCH_TOKEN = process.env.KILLSWITCH_TOKEN ?? ''

function checkToken(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${KILLSWITCH_TOKEN}` && KILLSWITCH_TOKEN !== ''
}

export async function POST(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'killswitch', value: 'false', updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deactivated: true, ts: new Date().toISOString() })
}
