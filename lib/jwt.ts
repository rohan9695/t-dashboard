// lib/jwt.ts
// Minimal HS256 JWT implementation using Web Crypto API.
// Works in both Node.js (>=18) and Edge runtime — no external dependencies.

const enc = new TextEncoder()

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlStr(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4)
  return decodeURIComponent(escape(atob(padded)))
}

function b64urlDecodeBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 86_400, // 24 h
): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body   = b64urlStr(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1_000),
    exp: Math.floor(Date.now() / 1_000) + expiresInSeconds,
  }))
  const data = `${header}.${body}`
  const key  = await hmacKey(secret)
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return `${data}.${b64url(sig)}`
}

export async function verifyJWT(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const data   = `${header}.${body}`
    const key    = await hmacKey(secret)
    const sigBuf = b64urlDecodeBytes(sig)
    const valid  = await crypto.subtle.verify('HMAC', key, sigBuf.buffer as ArrayBuffer, enc.encode(data))
    if (!valid) return null
    const pl = JSON.parse(b64urlDecode(body)) as Record<string, unknown>
    if (typeof pl.exp === 'number' && pl.exp < Date.now() / 1_000) return null
    return pl
  } catch {
    return null
  }
}
