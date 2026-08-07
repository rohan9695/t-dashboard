'use client'
// app/global-error.tsx
// Last-resort boundary — catches failures in the root layout itself, which
// app/error.tsx cannot reach. It replaces the whole document, so it has to ship
// its own <html>/<body> and inline styles rather than relying on the app's CSS
// having loaded.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          background: '#09090b',
          color: '#f4f4f5',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <p style={{ fontSize: '.875rem', fontWeight: 600, margin: 0 }}>
          The dashboard failed to load
        </p>
        <p style={{ fontSize: '.75rem', color: '#a1a1aa', margin: 0, maxWidth: '20rem' }}>
          Your accounts are unaffected. Check risk in NinjaTrader until this is back.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '.6rem 1rem', borderRadius: '.5rem', minHeight: '44px',
            background: '#27272a', color: '#fafafa', border: 'none',
            fontSize: '.75rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ fontSize: '.625rem', color: '#3f3f46', fontFamily: 'ui-monospace, monospace', margin: 0 }}>
            ref {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
