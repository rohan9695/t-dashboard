// test/integration/dashboard.ui.test.mjs
// Drives the real dashboard in a real browser at iPhone size, through the
// failure modes that actually happen: NT8 going quiet, NT8 dying, the backend
// disappearing, and an account blowing a limit.
//
// Skips (rather than fails) when no Chromium can be found — see test/browser.mjs.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findBrowser, openDashboard } from '../browser.mjs'
import { account, resetAll, seed, APP, DB } from '../helpers.mjs'

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-service-key'
const found = findBrowser()

let browser = null

before(async () => {
  if (found) browser = await chromium.launch(found)
})
after(async () => { if (browser) await browser.close() })

const skip = found ? false : 'no Chromium found (install Chrome, or set PLAYWRIGHT_BROWSERS_PATH)'

/** minutes-ago timestamp, for driving the staleness thresholds */
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

async function open(opts = {}) {
  const { context, page, consoleErrors } = await openDashboard(browser, { appUrl: APP, secret: SECRET, ...opts })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  // Give the client fetch + first poll a chance to land.
  await page.waitForTimeout(2_500)
  return { context, page, consoleErrors }
}

const FIVE = [
  ['PAAPEX3480290000007', 50088.64, 240.26, 'leader'],
  ['APEX3480290000089', 48929.70, -493.02, null],
  ['APEX3480290000090', 49784.54, -1096.60, null],
  ['APEX3480290000091', 47946.54, -968.10, null],
  ['APEX3480290000092', 47999.22, -109.20, null],
]

async function seedFive(overrides = {}) {
  for (const [id, bal, realized, role] of FIVE) {
    await seed(account(id, bal, { realized_pnl: realized, replikanto_role: role, ...overrides }))
  }
}

beforeEach(resetAll)

describe('dashboard on a phone', { skip }, () => {
  test('renders every account with its figures', async () => {
    await seedFive()
    const { context, page, consoleErrors } = await open({ viewMode: 'list' })
    const text = await page.locator('body').innerText()

    assert.match(text, /PAAPEX3480290000007/, 'leader account listed')
    assert.match(text, /\$50,088\.64/, 'net liq rendered')
    assert.match(text, /\$240\.26/, 'realized P&L rendered')
    assert.match(text, /TOTAL ACCOU/i)
    assert.match(text, /\n\s*5\s*\n/, 'summary counts all five accounts')
    assert.equal(consoleErrors.length, 0, `page errors: ${consoleErrors.join(', ')}`)
    await context.close()
  })

  test('the account list scrolls rather than clipping at 20 accounts', async () => {
    for (let i = 0; i < 20; i++) await seed(account(`APEX${String(i).padStart(4, '0')}`, 50000 + i))
    const { context, page } = await open({ viewMode: 'list' })
    const text = await page.locator('body').innerText()
    assert.match(text, /APEX0000/)
    assert.match(text, /APEX0019/, 'the twentieth account is present in the DOM')
    // The page must not scroll sideways on a phone.
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert.equal(overflows, false, 'no horizontal scroll at phone width')
    await context.close()
  })

  test('a breached account reads as red figures, with no badge or red dot', async () => {
    await seed(account('APEX1', 48900, { status: 'breached', dist_to_daily_loss: 0, realized_pnl: -1100 }))
    const { context, page } = await open()
    const text = await page.locator('body').innerText()

    assert.doesNotMatch(text, /DAILY LOSS|DRAWDOWN/i, 'no breach badges')
    assert.equal(await page.locator('span.bg-red-500').count(), 0, 'no red status dots')
    assert.match(text, /\$0\.00/, 'the blown limit shows as 0.00')
    await context.close()
  })
})

describe('when NT8 stops sending', { skip }, () => {
  test('a quiet account is flagged aged, not offline', async () => {
    // 15 min: past the 10 min "aged" mark, well before the 30 min offline mark.
    await seedFive({ last_update: minsAgo(15) })
    const { context, page } = await open({ viewMode: 'list' })

    assert.ok(await page.locator('span.bg-amber-400').count() > 0, 'amber dot for a quiet account')
    assert.equal(await page.locator('span.bg-emerald-400').count(), 0, 'not shown as live')
    await context.close()
  })

  test('a long-silent account keeps its last figures, greyed (list view)', async () => {
    await seedFive({ last_update: minsAgo(45) })
    const { context, page } = await open({ viewMode: 'list' })
    const text = await page.locator('body').innerText()

    assert.ok(await page.locator('span.bg-zinc-600').count() > 0, 'grey dot marks it offline')
    assert.equal(await page.locator('span.bg-emerald-400').count(), 0, 'not shown as live')
    assert.match(text, /\$50,088\.64/, 'last known figures still displayed, not blanked')
    await context.close()
  })

  test('card view spells OFFLINE out in words', async () => {
    await seedFive({ last_update: minsAgo(45) })
    const { context, page } = await open({ viewMode: 'card' })
    assert.match(await page.locator('body').innerText(), /OFFLINE/)
    await context.close()
  })

  test('NT8 down across every account raises the NinjaTrader banner', async () => {
    await seedFive({ last_update: minsAgo(45) })
    const { context, page } = await open()
    await page.waitForTimeout(1_500)
    const text = await page.locator('body').innerText()

    assert.match(text, /NinjaTrader offline/i)
    assert.match(text, /no data for/i, 'says how long it has been')
    await context.close()
  })
})

describe('when the backend is unreachable', { skip }, () => {
  test('the last known figures stay on screen, labelled as saved', async () => {
    await seedFive()
    const { context, page } = await open()
    assert.match(await page.locator('body').innerText(), /PAAPEX3480290000007/, 'sanity: loaded once')

    // Cut every route to data — the server route and the direct database read.
    await context.route('**/api/data**', (r) => r.abort())
    await context.route('**/rest/v1/**', (r) => r.abort())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(12_000) // 3 failed polls at 3s, plus slack

    const text = await page.locator('body').innerText()
    assert.match(text, /PAAPEX3480290000007/, 'accounts still rendered from cache')
    assert.match(text, /\$240\.26/, 'real figures, not placeholders')
    assert.doesNotMatch(text, /No accounts connected/, 'never the empty state when data is known')
    assert.match(text, /saved data|not updating/i, 'and it says the figures are not live')
    await context.close()
  })

  test('a first-ever visit with no backend degrades instead of crashing', async () => {
    const { context, page, consoleErrors } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await context.route('**/api/data**', (r) => r.abort())
    await context.route('**/rest/v1/**', (r) => r.abort())
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(12_000)

    const text = await page.locator('body').innerText()
    assert.match(text, /No accounts connected|not updating|saved data/i, 'shows a real state, not a blank page')
    assert.equal(await page.locator('.animate-pulse.rounded-xl').count(), 0, 'no skeleton cards left shimmering once the attempt has failed')
    assert.ok(text.trim().length > 0, 'page is not blank')
    assert.equal(consoleErrors.length, 0, `unhandled page errors: ${consoleErrors.join(', ')}`)
    await context.close()
  })

  test('it recovers on its own when the backend returns', async () => {
    await seedFive()
    const { context, page } = await open()

    await context.route('**/api/data**', (r) => r.abort())
    await context.route('**/rest/v1/**', (r) => r.abort())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(12_000)
    assert.match(await page.locator('body').innerText(), /saved data|not updating/i)

    await context.unroute('**/api/data**')
    await context.unroute('**/rest/v1/**')
    await page.waitForTimeout(6_000) // a couple of 3s poll cycles

    const text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /saved data|not updating/i, 'degraded banner clears by itself')
    assert.match(text, /PAAPEX3480290000007/)
    await context.close()
  })
})

describe('manual refresh', { skip }, () => {
  test('picks up data that appeared after load', async () => {
    await seedFive()
    const { context, page } = await open({ viewMode: 'list' })
    assert.doesNotMatch(await page.locator('body').innerText(), /APEXLATE/)

    await seed(account('APEXLATE', 51234.56))
    await page.getByRole('button', { name: /refresh data/i }).first().click()
    await page.waitForTimeout(3_000)

    assert.match(await page.locator('body').innerText(), /APEXLATE/, 'new account appears after a manual refresh')
    await context.close()
  })
})
