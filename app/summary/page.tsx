// app/summary/page.tsx
// Read-only grouped daily summary. Deliberately does NO server-side data fetch:
// the page is static and RealtimeProvider hydrates it in the browser, so this
// route adds no Worker CPU or Supabase load beyond what the main page already
// causes. It shares the same Face ID gate and the same localStorage row cache.
import Link from 'next/link'
import { RealtimeProvider } from '@/components/RealtimeProvider'
import { VisibilityProvider } from '@/components/VisibilityProvider'
import { WebAuthnGate } from '@/components/WebAuthnGate'
import { HeartbeatMonitor } from '@/components/HeartbeatMonitor'
import { SyncBanner } from '@/components/SyncBanner'
import { RefreshButton } from '@/components/RefreshButton'
import { GroupedSummary } from '@/components/GroupedSummary'

export const metadata = { title: 'Daily Summary · Trader Dashboard' }

export default function SummaryPage() {
  return (
    <WebAuthnGate>
      <RealtimeProvider initialAccounts={[]}>
        <VisibilityProvider>
          <div className="min-h-screen flex flex-col header-safe">
            <SyncBanner />
            <HeartbeatMonitor />

            <main className="flex-1 px-3 py-4 space-y-4 max-w-2xl mx-auto w-full">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/"
                  prefetch={false}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-[11px] font-medium active:bg-zinc-700 transition-colors min-h-[36px]"
                >
                  ← Dashboard
                </Link>
                <RefreshButton />
              </div>

              <GroupedSummary />
            </main>

            <footer className="text-center text-[10px] text-zinc-700 pt-4 border-t border-zinc-800/40 footer-safe">
              Daily Summary · read-only
            </footer>
          </div>
        </VisibilityProvider>
      </RealtimeProvider>
    </WebAuthnGate>
  )
}
