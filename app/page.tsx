// app/page.tsx
// Server component: fetches initial account snapshot from Supabase,
// passes it to RealtimeProvider so the page is populated immediately
// on load (no flash of empty state).

import { createServiceClient } from '@/lib/supabase/server'
import { ACCOUNT_TIMEOUT_SECONDS, type AccountRow } from '@/lib/trading-logic'
import { RealtimeProvider } from '@/components/RealtimeProvider'
import { StatusBar } from '@/components/StatusBar'
import { SummaryBar } from '@/components/SummaryBar'
import { AccountsGrid } from '@/components/AccountsGrid'
import { StaleBanner } from '@/components/StaleBanner'

export const revalidate = 0 // always fresh on server render

async function getInitialAccounts(): Promise<AccountRow[]> {
  try {
    const supabase = createServiceClient()
    const cutoff = new Date(Date.now() - ACCOUNT_TIMEOUT_SECONDS * 1000).toISOString()

    const { data } = await supabase
      .from('accounts')
      .select('*')
      .gte('last_update', cutoff)
      .order('account_id')

    return (data ?? []) as AccountRow[]
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  const initialAccounts = await getInitialAccounts()

  return (
    <RealtimeProvider initialAccounts={initialAccounts}>
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 px-4 py-3">
          <StatusBar />
        </header>

        {/* Amber stale-data banner — auto-dismisses on fresh data */}
        <StaleBanner />

        <main className="flex-1 px-3 py-4 space-y-4 max-w-5xl mx-auto w-full">
          {/* Summary stats — mirrors three stat cards from main.py */}
          <SummaryBar />

          {/* Account cards grid */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-3">
              All Accounts
            </h2>
            <AccountsGrid />
          </section>
        </main>

        <footer className="text-center text-[10px] text-zinc-700 py-4 border-t border-zinc-800/40">
          Trader Dashboard · Live from NinjaTrader
        </footer>
      </div>
    </RealtimeProvider>
  )
}
