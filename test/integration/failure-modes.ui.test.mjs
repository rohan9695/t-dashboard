// test/integration/failure-modes.ui.test.mjs
// The failures actually hit day to day, driven in a real browser at phone size.
//
//   NT8 not firing                       -> accounts go quiet, then offline
//   NT8 firing but Replikanto not copying -> leader in a position, followers flat
//   dashboard "online" while NT8 is dead  -> freshness must reflect NT8, not the host
//   host offline (Cloudflare/Netlify)     -> cached figures, said out loud
//
// Skips when no Chromium is available — see test/browser.mjs.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findBrowser, openDashboard, until, waitForAccounts } from '../browser.mjs'
import { account, resetAll, seed, postJson, notifications, APP } from '../helpers.mjs'

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-service-key'
const found = findBrowser()
const skip = found ? false : 'no Chromium found'

let browser = null
before(async () => { if (found) browser = await chromium.launch(found) })
after(async () => { if (browser) await browser.close() })

const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

async function open(opts = {}) {
  const r = await openDashboard(browser, { appUrl: APP, secret: SECRET, ...opts })
  await r.page.goto(APP, { waitUntil: 'domcontentloaded' })
  await waitForAccounts(r.page, { viewMode: opts.viewMode ?? 'card' })
  return r
}

const LEADER = 'PAAPEX3480290000007'
const FOLLOWERS = ['APEX3480290000089', 'APEX3480290000090', 'APEX3480290000091', 'APEX3480290000092']

/** leaderOpen / followerOpen let a copier failure be described directly. */
async function seedDesk({ leaderOpen = 0, followerOpen = 0, lastUpdate, followerOverrides = {} } = {}) {
  await seed(account(LEADER, 50088.64, {
    replikanto_role: 'leader', dollar_open: leaderOpen, unrealized_pnl: leaderOpen,
    ...(lastUpdate ? { last_update: lastUpdate } : {}),
  }))
  for (const id of FOLLOWERS) {
    await seed(account(id, 49000, {
      replikanto_role: 'follower', dollar_open: followerOpen, unrealized_pnl: followerOpen,
      ...(lastUpdate ? { last_update: lastUpdate } : {}),
      ...followerOverrides,
    }))
  }
}

beforeEach(resetAll)

describe('NT8 not firing', { skip }, () => {
  test('quiet accounts are not presented as live', async () => {
    await seedDesk({ lastUpdate: minsAgo(15) })
    const { context, page } = await open({ viewMode: 'list' })
    await until('amber dot', async () => (await page.locator('span.bg-amber-400').count()) > 0)
    assert.equal(await page.locator('span.bg-emerald-400').count(), 0, 'nothing claims to be live')
    await context.close()
  })

  test('a dead NT8 raises the offline banner and keeps the last figures', async () => {
    await seedDesk({ lastUpdate: minsAgo(45) })
    const { context, page } = await open({ viewMode: 'list' })
    await until('NinjaTrader offline banner',
      async () => /NinjaTrader offline/i.test(await page.locator('body').innerText()))
    const text = await page.locator('body').innerText()
    assert.match(text, /NinjaTrader offline/i)
    assert.match(text, /\$50,088\.64/, 'last known figures retained')
    await context.close()
  })
})

describe('NT8 firing but Replikanto not copying', { skip }, () => {
  test('leader in a position while followers sit flat raises the copier banner', async () => {
    // The leader's position must look older than the grace period, which is
    // measured from when the dashboard first sees it — so let it sit.
    await seedDesk({ leaderOpen: 425.50, followerOpen: 0 })
    const { context, page } = await open()
    await until('copier banner past the 45s grace period',
      async () => /Replikanto not copying/i.test(await page.locator('body').innerText()),
      { timeout: 90_000 })

    const text = await page.locator('body').innerText()
    assert.match(text, /Replikanto not copying/i)
    assert.match(text, /4 of 4/, 'names how many accounts failed to copy')
    await context.close()
  })

  test('no banner when the copier worked', async () => {
    await seedDesk({ leaderOpen: 425.50, followerOpen: 418.25 })
    const { context, page } = await open()
    await page.waitForTimeout(50_000) // must outlast GRACE_MS to prove absence
    assert.doesNotMatch(await page.locator('body').innerText(), /Replikanto not copying/i)
    await context.close()
  })

  test('no banner while the leader is flat', async () => {
    await seedDesk({ leaderOpen: 0, followerOpen: 0 })
    const { context, page } = await open()
    await page.waitForTimeout(6_000)
    assert.doesNotMatch(await page.locator('body').innerText(), /Replikanto not copying/i)
    await context.close()
  })

  test('offline followers are not counted as failures to copy', async () => {
    await seedDesk({ leaderOpen: 425.50, followerOpen: 0, followerOverrides: { last_update: minsAgo(45) } })
    const { context, page } = await open()
    await page.waitForTimeout(50_000) // must outlast GRACE_MS to prove absence
    assert.doesNotMatch(
      await page.locator('body').innerText(), /Replikanto not copying/i,
      'an offline account was never going to fill',
    )
    await context.close()
  })

  test('a partial fill is reported so the addon can escalate the phone alert', async () => {
    // Belt and braces: the dashboard banner needs the page open, the phone
    // alert does not. Only the leader filled out of five expected.
    //
    // The actual ntfy push now happens in nt8/AccountMonitor.cs
    // (SendNtfyAsync), sent directly from the trading machine — see
    // CLAUDE.md's Fill notifications section for why it moved off Cloudflare.
    // That C# code isn't reachable from this Node suite, so the assertion
    // here stops at what this route is actually responsible for: reporting
    // the round accurately enough for the addon to decide urgent vs default.
    const res = await postJson('/api/trade-event', {
      symbol: 'ES', direction: 'long', event_type: 'open',
      accounts: [LEADER], total_accounts: 5,
    })
    const body = await res.json()
    assert.equal(body.accounts, 1)
    assert.equal(body.expected, 5)
    assert.equal(body.partial, true)
    assert.equal((await notifications()).length, 0, 'this route no longer pushes — the addon does')
  })
})

describe('knowing the desk is ready WITHOUT a trade', { skip }, () => {
  test('an account that stopped reporting is flagged before any trade fires', async () => {
    // Every account flat, no position anywhere. One follower dropped 10 minutes
    // ago while the rest keep reporting.
    await seedDesk({ leaderOpen: 0, followerOpen: 0 })
    await seed(account(FOLLOWERS[0], 49000, {
      replikanto_role: 'follower', dollar_open: 0, last_update: minsAgo(10),
    }))

    const { context, page } = await open({ viewMode: 'list' })
    await until('readiness warning',
      async () => /not reporting/i.test(await page.locator('body').innerText()))
    const text = await page.locator('body').innerText()

    assert.match(text, /not reporting/i, 'warns with no trade in flight')
    assert.match(text, /would reach 4 of 5/i, 'says how many a trade would actually reach')
    await context.close()
  })

  test('accounts that vanished from the list are still counted as missing', async () => {
    // Four of five accounts hidden — sync-accounts stopped seeing them in NT8's
    // live list. The dashboard used to show "TOTAL ACCOUNTS 1", a green dot and
    // no banner at all: the readiness check filtered hidden rows out before
    // counting, so it could not see its own case.
    await seed(account(LEADER, 50088.64, { replikanto_role: 'leader', dollar_open: 0 }))
    for (const id of FOLLOWERS) {
      await seed(account(id, 49000, { replikanto_role: 'follower', dollar_open: 0, hidden: true }))
    }

    const { context, page } = await open({ viewMode: 'list' })
    await until('readiness warning despite the accounts being hidden',
      async () => /not reporting/i.test(await page.locator('body').innerText()))
    const text = await page.locator('body').innerText()

    assert.match(text, /4 accounts not reporting/i, 'counts the hidden accounts')
    assert.match(text, /would reach 1 of 5/i, 'denominator includes what vanished')
    await context.close()
  })

  test('a long-retired hidden account does not nag forever', async () => {
    // hidden rows are never hard-deleted, so an account genuinely pulled from
    // NT8 must eventually stop counting as missing or the banner is permanent.
    await seedDesk({ leaderOpen: 0, followerOpen: 0 })
    await seed(account('APEXRETIRED', 49000, { hidden: true, last_update: minsAgo(60 * 24 * 3) }))

    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(2_000)
    assert.doesNotMatch(await page.locator('body').innerText(), /not reporting/i)
    await context.close()
  })

  test('a blown account is gone, not nagged about for the rest of the day', async () => {
    // A liquidated account is hidden for a reason we can actually identify:
    // batch-update stamped it 'breached' when NT8 reported the equity gone,
    // before sync-accounts hid the row. It is not coming back, so "a trade now
    // would reach 4 of 5" is not a problem to fix — and the 12-hour retirement
    // window meant it said so until the next morning.
    await seedDesk({ leaderOpen: 0, followerOpen: 0 })
    await seed(account(FOLLOWERS[0], 0, {
      replikanto_role: 'follower', dollar_open: 0, hidden: true, status: 'breached',
    }))

    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(2_000)
    const text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /not reporting/i, 'a blown account is removed, not missing')
    assert.doesNotMatch(text, new RegExp(FOLLOWERS[0]), 'and it is off the grid entirely')
    await context.close()
  })

  test('a dropped account still warns even with a blown one beside it', async () => {
    // The exemption above must be narrow. Losing one account to a breach does
    // not make a genuinely dropped account acceptable.
    await seedDesk({ leaderOpen: 0, followerOpen: 0 })
    await seed(account(FOLLOWERS[0], 0, {
      replikanto_role: 'follower', dollar_open: 0, hidden: true, status: 'breached',
    }))
    await seed(account(FOLLOWERS[1], 49000, {
      replikanto_role: 'follower', dollar_open: 0, hidden: true,
    }))

    const { context, page } = await open({ viewMode: 'list' })
    await until('the dropped account still warns',
      async () => /not reporting/i.test(await page.locator('body').innerText()))
    const text = await page.locator('body').innerText()
    assert.match(text, /1 account not reporting/i, 'only the dropped one counts')
    assert.match(text, /would reach 3 of 4/i, 'the blown account leaves the denominator too')
    await context.close()
  })

  test('a quiet desk is NOT mistaken for a dropped account', async () => {
    // Everything equally old — NT8 simply has nothing to say between trades.
    // An absolute staleness check would cry wolf here; a relative one must not.
    await seedDesk({ lastUpdate: minsAgo(20) })
    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(2_000)
    assert.doesNotMatch(await page.locator('body').innerText(), /not reporting/i)
    await context.close()
  })

  test('a healthy desk shows no banner at all', async () => {
    await seedDesk()
    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(2_000)
    const text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /not reporting|not copying/i)
    await context.close()
  })

  test('an active copier failure outranks the readiness warning', async () => {
    await seedDesk({ leaderOpen: 425.50, followerOpen: 0 })
    await seed(account(FOLLOWERS[0], 49000, {
      replikanto_role: 'follower', dollar_open: 0, last_update: minsAgo(10),
    }))
    const { context, page } = await open()
    await until('copier banner takes precedence',
      async () => /not copying/i.test(await page.locator('body').innerText()),
      { timeout: 90_000 })
    const text = await page.locator('body').innerText()
    assert.match(text, /not copying/i, 'the worse problem is the one shown')
    assert.doesNotMatch(text, /not reporting/i, 'only one banner at a time')
    await context.close()
  })
})

describe('stale figures while a position is open', { skip }, () => {
  test('a four-minute-old P&L is NOT presented as live', async () => {
    // The real case: MNQ long, dashboard showing -$86.00 while the platform
    // showed +$82.50. The figure was a genuine reading from ~4 minutes earlier,
    // and the dot was green because the flat threshold is 10 minutes.
    await seed(account(LEADER, 50159.42, {
      replikanto_role: 'leader', dollar_open: -86, unrealized_pnl: -86,
      last_update: minsAgo(4),
    }))
    await seed(account(FOLLOWERS[0], 49912.98, {
      replikanto_role: 'follower', dollar_open: -91.5, unrealized_pnl: -91.5,
      last_update: minsAgo(4),
    }))

    const { context, page } = await open({ viewMode: 'list' })
    await until('no account still claims to be live',
      async () => (await page.locator('span.bg-emerald-400').count()) === 0)
    assert.equal(await page.locator('span.bg-emerald-400').count(), 0,
      'a moving P&L four minutes old must not read as live')
    await context.close()
  })

  test('the same four minutes is fine when flat', async () => {
    // Between trades NT8 genuinely goes quiet; flagging that would be noise.
    await seedDesk({ leaderOpen: 0, followerOpen: 0, lastUpdate: minsAgo(4) })
    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(2_000)
    assert.ok((await page.locator('span.bg-emerald-400').count()) > 0,
      'a flat desk four minutes quiet is normal and must stay green')
    await context.close()
  })
})

describe('dashboard claiming to be online when it is not', { skip }, () => {
  test('freshness tracks NT8, not the host answering', async () => {
    // The host is up and serving happily; NT8 stopped 45 minutes ago. The
    // dashboard must not read as live just because the request succeeded.
    await seedDesk({ lastUpdate: minsAgo(45) })
    const { context, page } = await open({ viewMode: 'list' })
    await until('offline banner', async () => /NinjaTrader offline/i.test(await page.locator('body').innerText()))
    const text = await page.locator('body').innerText()

    assert.equal(await page.locator('span.bg-emerald-400').count(), 0, 'no live dots')
    assert.match(text, /NinjaTrader offline/i, 'and it says so')
    await context.close()
  })

  test('a stale row does not become live merely by being re-served', async () => {
    await seedDesk({ lastUpdate: minsAgo(45) })
    const { context, page } = await open({ viewMode: 'list' })
    await page.waitForTimeout(4_000) // a poll cycle re-fetches the same stale rows
    assert.equal(await page.locator('span.bg-emerald-400').count(), 0)
    await context.close()
  })
})

describe('the host is down (Cloudflare / Netlify)', { skip }, () => {
  test('figures survive with an honest label, and recover on their own', async () => {
    await seedDesk()
    const { context, page } = await open({ viewMode: 'list' })
    assert.match(await page.locator('body').innerText(), /\$50,088\.64/)

    await context.route('**/api/data**', (r) => r.abort())
    await context.route('**/rest/v1/**', (r) => r.abort())
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Net liq below is a list-view figure, so the reload has to land back in
    // list view before it can be asserted on.
    await waitForAccounts(page, { viewMode: 'list' })
    await until('degraded banner', async () => /saved data|not updating/i.test(await page.locator('body').innerText()),
      { timeout: 30_000 })

    let text = await page.locator('body').innerText()
    assert.match(text, /\$50,088\.64/, 'figures still on screen')
    assert.match(text, /saved data|not updating/i, 'and flagged as not live')

    await context.unroute('**/api/data**')
    await context.unroute('**/rest/v1/**')
    await until('banner clears once the host returns',
      async () => !/saved data|not updating/i.test(await page.locator('body').innerText()),
      { timeout: 30_000 })
    text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /saved data|not updating/i, 'clears itself once the host returns')
    await context.close()
  })
})
