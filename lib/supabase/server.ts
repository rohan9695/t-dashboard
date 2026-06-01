// lib/supabase/server.ts
import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS, used only in API routes (server-side)
// NEVER import this in client components
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://gvbtnsktudmgmpamkhnl.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function createServiceClient() {
  return createClient(
    SUPABASE_URL,
    SERVICE_KEY,
    { auth: { persistSession: false } },
  )
}
