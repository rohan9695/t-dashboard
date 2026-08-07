// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

// Env first, hardcoded value as the fallback — which is what the note in
// CLAUDE.md always said this was. Hardcoding it OUTRIGHT meant the browser
// always talked to production, so the test suite could not be pointed at a mock
// and CI read the real database. It also made every read in a restricted
// network burn the full client-side timeout before the /api/data fallback ran.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://gvbtnsktudmgmpamkhnl.supabase.co'
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YnRuc2t0dWRtZ21wYW1raG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjQ5MjQsImV4cCI6MjA5NTkwMDkyNH0.9K4KcZVEosgpJWK0uqeswVIK-bDfE1SpUgZouPAa3zo'

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
