// app/api/health/route.ts
// Answers one question a broken host cannot otherwise answer: is this
// deployment actually configured?
//
// Netlify "never worked" for months and nobody could say why, because a
// missing SUPABASE_SERVICE_ROLE_KEY does not throw — lib/supabase/server.ts
// falls back to '' and builds a client that 401s on every query. The site
// serves, the routes 500, and no surface anywhere names the cause. Same shape
// as the other silent failures in this project (see CLAUDE.md rule 11), just
// in configuration rather than data.
//
// Deliberately UNAUTHENTICATED (listed in middleware's OPEN_PREFIXES). It has
// to be: on a host where API_KEY itself is unset, every authenticated route is
// unreachable, so a gated health check would be unreachable exactly when it is
// needed. Only booleans are returned — never a value, a prefix, or a URL — so
// the worst an anonymous caller learns is that this host is misconfigured,
// which they could already infer from the 500s.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// A health check that hangs is worse than one that fails: it turns a fast
// "misconfigured" into an ambiguous timeout.
const DB_TIMEOUT_MS = 2_000

// NTFY_TOPIC is intentionally absent — unset means notifications off, which is
// a valid configuration, not a fault. It is still reported below so the
// difference between "off on purpose" and "forgotten" is visible.
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_KEY',
] as const

export async function GET() {
  const config: Record<string, boolean> = {}
  for (const name of REQUIRED) config[name] = Boolean(process.env[name])
  config.NTFY_TOPIC = Boolean(process.env.NTFY_TOPIC)

  const missing = REQUIRED.filter((name) => !process.env[name])

  // A live round trip, because a present key can still be the wrong key — the
  // failure this is meant to catch looks identical either way from outside.
  let database: 'ok' | 'denied' | 'unreachable' | 'timeout' | 'skipped' = 'skipped'
  if (!missing.includes('SUPABASE_SERVICE_ROLE_KEY') && !missing.includes('NEXT_PUBLIC_SUPABASE_URL')) {
    try {
      const probe = createServiceClient()
        .from('accounts')
        .select('account_id')
        .limit(1)
        .then(({ error }) => (error ? 'denied' as const : 'ok' as const))

      database = await Promise.race([
        probe,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)),
      ])
    } catch {
      database = 'unreachable'
    }
  }

  const ok = missing.length === 0 && database === 'ok'

  return NextResponse.json(
    { ok, config, missing, database, ts: new Date().toISOString() },
    // 503 rather than 200 so a misconfigured host is obvious to anything that
    // only reads the status line, including a plain curl -I.
    { status: ok ? 200 : 503 },
  )
}
