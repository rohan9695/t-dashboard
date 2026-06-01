// lib/supabase/server.ts
import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS, used only in API routes (server-side)
// NEVER import this in client components
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}
