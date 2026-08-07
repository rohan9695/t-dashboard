'use client'
// app/error.tsx
// Route-level error boundary.
//
// Without this, a single render exception — one malformed row, one field that
// came back null — replaces the entire dashboard with a blank white page and no
// way back. A risk display going silently blank is the failure mode that matters
// most here, so the boundary always offers a way forward and never hides that
// something broke.

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard] render error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-red-950 border border-red-900 flex items-center justify-center text-2xl">
        ⚠️
      </div>
      <div>
        <p className="text-sm font-semibold">The dashboard hit an error</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-xs">
          Your accounts are unaffected — this is a display problem. Check risk in
          NinjaTrader until it comes back.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 text-xs font-semibold active:bg-zinc-700 min-h-[44px]"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-semibold active:bg-zinc-800 min-h-[44px]"
        >
          Reload
        </button>
      </div>

      {error.digest && (
        <p className="text-[10px] text-zinc-700 font-mono">ref {error.digest}</p>
      )}
    </div>
  )
}
