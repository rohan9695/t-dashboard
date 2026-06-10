// lib/auth-secret.ts
// Single source of truth for the JWT signing secret.
// Prefers the JWT_SECRET env var; falls back to the HMAC signature portion
// of SUPABASE_SERVICE_ROLE_KEY (which has high entropy and is already a secret).
// Works on both Node.js and Edge runtimes.

export const AUTH_JWT_SECRET: string =
  process.env.JWT_SECRET ??
  process.env.SUPABASE_SERVICE_ROLE_KEY?.split('.').pop() ??
  ''
