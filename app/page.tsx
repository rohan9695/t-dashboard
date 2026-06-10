// app/page.tsx
import { createServiceClient } from '@/lib/supabase/server'
import { ACCOUNT_TIMEOUT_SECONDS, type AccountRow } from '@/lib/trading-logic'
import { RealtimeProvider } from '@/components/RealtimeProvider'
import { StatusBar } from '@/components/StatusBar'
import { SummaryBar } from '@/components/SummaryBar'
import { AccountsGrid } from '@/components/AccountsGrid'
import { StaleBanner } from '@/components/StaleBanner'
import { KillswitchBanner } from '@/components/KillswitchBanner'
import { WebAuthnGate } from '@/components/WebAuthnGate'
import { ToastProvider } from '@/components/ToastProvider'
import { VisibilityProvider } from '@/components/VisibilityProvider'
import { HeartbeatMonitor } from '@/components/HeartbeatMonitor'

export const revalidate = 0

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
    <WebAuthnGate>
      <RealtimeProvider initialAccounts={initialAccounts}>
        <ToastProvider>
          <VisibilityProvider>
            <div className="min-h-screen flex flex-col">
              <KillswitchBanner />

              <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 px-4 pb-3 header-safe">
                <StatusBar />
              </header>

              <HeartbeatMonitor />
              <StaleBanner />

              <main className="flex-1 px-3 py-4 space-y-4 max-w-5xl mx-auto w-full">
                <SummaryBar />

                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-3">
                    All Accounts
                  </h2>
                  <AccountsGrid />
                </section>
              </main>

              <footer className="text-center text-[10px] text-zinc-700 pt-4 border-t border-zinc-800/40 footer-safe">
                Trader Dashboard · Live from NinjaTrader
              </footer>
            </div>
          </VisibilityProvider>
        </ToastProvider>
      </RealtimeProvider>
    </WebAuthnGate>
  )
}
