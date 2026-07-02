// app/page.tsx
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { type AccountRow } from '@/lib/trading-logic'
import { verifyJWT } from '@/lib/jwt'
import { AUTH_JWT_SECRET } from '@/lib/auth-secret'
import { RealtimeProvider } from '@/components/RealtimeProvider'
import { SummaryBar } from '@/components/SummaryBar'
import { AccountsGrid } from '@/components/AccountsGrid'
import { KillswitchBanner } from '@/components/KillswitchBanner'
import { ToastProvider } from '@/components/ToastProvider'
import { VisibilityProvider } from '@/components/VisibilityProvider'
import { HeartbeatMonitor } from '@/components/HeartbeatMonitor'
import { WebAuthnGate } from '@/components/WebAuthnGate'

export const revalidate = 0

async function hasValidSession(): Promise<boolean> {
  if (!AUTH_JWT_SECRET) return false
  const cookieStore = await cookies()
  const token = cookieStore.get('td_session')?.value
  if (!token) return false
  return (await verifyJWT(token, AUTH_JWT_SECRET)) !== null
}

async function getInitialAccounts(): Promise<AccountRow[]> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .order('account_id')
    return (data ?? []) as AccountRow[]
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  // Never embed real account data in the page for an unauthenticated request —
  // the gate below is a client-side overlay, so the initial HTML/RSC payload
  // must not contain anything sensitive until the session cookie proves who's
  // asking. Once authenticated, RealtimeProvider's own client-side fetch picks
  // up the real data immediately after unlock.
  const authed = await hasValidSession()
  const initialAccounts = authed ? await getInitialAccounts() : []

  return (
    <WebAuthnGate>
      <RealtimeProvider initialAccounts={initialAccounts}>
        <ToastProvider>
          <VisibilityProvider>
            <div className="min-h-screen flex flex-col header-safe">
              <KillswitchBanner />

              <HeartbeatMonitor />

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
