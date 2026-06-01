// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://gvbtnsktudmgmpamkhnl.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YnRuc2t0dWRtZ21wYW1raG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjQ5MjQsImV4cCI6MjA5NTkwMDkyNH0.9K4KcZVEosgpJWK0uqeswVIK-bDfE1SpUgZouPAa3zo',
  )
}
