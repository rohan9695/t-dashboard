// supabase/functions/keep-warm/index.ts
// Supabase Edge Function: pings /api/heartbeat on the Vercel deployment
// during market hours to prevent cold starts.
//
// Deploy:
//   supabase functions deploy keep-warm
//
// Secrets (set via: supabase secrets set KEY=value):
//   VERCEL_DASHBOARD_URL  - e.g. https://t-dashboard-pi.vercel.app
//   API_SECRET_TOKEN      - Bearer token sent with ping (same as Vercel env)
//   ALERT_EMAIL           - email address for failure alerts
//   RESEND_API_KEY        - Resend API key for sending email
//
// Cron schedule (Supabase dashboard → Integrations → Cron):
//   */5 14-18 * * 1-5
//   (14-18 UTC covers both EST 9am-1pm and EDT 9am-1pm)

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VERCEL_URL               = Deno.env.get('VERCEL_DASHBOARD_URL') ?? ''
const API_SECRET_TOKEN         = Deno.env.get('API_SECRET_TOKEN') ?? ''
const ALERT_EMAIL              = Deno.env.get('ALERT_EMAIL') ?? ''
const RESEND_API_KEY           = Deno.env.get('RESEND_API_KEY') ?? ''

function isMarketHours(): boolean {
  const now = new Date()
  const tz = 'America/New_York'

  // weekday: 0=Sun … 6=Sat
  const day = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .format(now)
      .slice(0, 1), // unused — use numeric day below
  )
  const dayNum = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  if (['Sat', 'Sun'].includes(dayNum)) return false

  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
      .format(now),
  )
  return hour >= 9 && hour < 13
}

Deno.serve(async () => {
  if (!isMarketHours()) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'outside 09:00-13:00 ET Mon-Fri' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!VERCEL_URL) {
    return new Response(JSON.stringify({ error: 'VERCEL_DASHBOARD_URL not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const start = Date.now()
  let status = 'ok'

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'supabase-keep-warm/1.0',
    }
    if (API_SECRET_TOKEN) {
      headers['Authorization'] = `Bearer ${API_SECRET_TOKEN}`
    }

    const res = await fetch(`${VERCEL_URL}/api/heartbeat`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    status = res.ok ? 'ok' : `http_${res.status}`
  } catch (e) {
    status = 'error'
    console.error('[keep-warm] ping failed:', e)
  }

  const responseMs = Date.now() - start

  // Log to warmup_log (fire-and-forget is intentional; don't let log failure block response)
  supabase
    .from('warmup_log')
    .insert({ pinged_at: new Date().toISOString(), status, response_ms: responseMs })
    .then(({ error }) => { if (error) console.error('[keep-warm] log error:', error.message) })

  // Alert on 3 consecutive failures
  if (status !== 'ok' && RESEND_API_KEY && ALERT_EMAIL) {
    const { data: recent } = await supabase
      .from('warmup_log')
      .select('status')
      .order('pinged_at', { ascending: false })
      .limit(3)

    const allFailed = (recent ?? []).length >= 3 && (recent ?? []).every((r) => r.status !== 'ok')

    if (allFailed) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'alerts@resend.dev',
          to: ALERT_EMAIL,
          subject: '🚨 Trader Dashboard: 3 consecutive heartbeat failures',
          html: `<p>The keep-warm function has detected 3 consecutive ping failures on the Trader Dashboard.</p>
                 <p>URL: ${VERCEL_URL}/api/heartbeat</p>
                 <p>Last failure: ${new Date().toISOString()}</p>
                 <p>Response: ${status} (${responseMs}ms)</p>`,
        }),
      }).catch((e) => console.error('[keep-warm] resend error:', e))
    }
  }

  return new Response(
    JSON.stringify({ ok: true, status, response_ms: responseMs }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
