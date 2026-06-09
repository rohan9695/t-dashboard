// supabase/functions/session-lockout/index.ts
// Supabase Edge Function: sets all accounts locked=true at 21:00 UTC (4pm ET) weekdays.
// Only triggers if session_auto_lockout preference is enabled.
//
// Deploy: supabase functions deploy session-lockout
// Cron:   0 21 * * 1-5   (run at 21:00 UTC Mon-Fri)

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Check if preference is enabled
  const { data: pref } = await supabase
    .from('user_preferences')
    .select('value')
    .eq('preference_key', 'session_auto_lockout')
    .single()

  const enabled = (pref?.value as { v?: boolean } | null)?.v === true
  if (!enabled) {
    return new Response(JSON.stringify({ skipped: true, reason: 'session_auto_lockout is OFF' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Lock all active accounts
  const { data, error } = await supabase
    .from('accounts')
    .update({ status: 'stale' })
    .eq('status', 'active')
    .select('account_id')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const lockedIds = (data ?? []).map((r) => r.account_id as string)
  console.log(`[session-lockout] locked ${lockedIds.length} accounts at 21:00 UTC`)

  return new Response(
    JSON.stringify({ locked: lockedIds.length, accounts: lockedIds, ts: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
