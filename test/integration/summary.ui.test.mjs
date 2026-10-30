// test/integration/summary.ui.test.mjs
// The read-only grouped summary page (/summary), and the one button on the main
// dashboard that leads to it. Skips when no Chromium is available.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findBrowser, openDashboard, until, waitForAccounts } from '../browser.mjs'
import { account, resetAll, seed, APP } from '../helpers.mjs'

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-service-key'
const found = findBrowser()
let browser = null

before(async () => { if (found) browser = await chromium.launch(found) })
after(async () => { if (browser) await browser.close() })
beforeEach(resetAll)

const skip = found ? false : 'no Chromium found (install Chrome, or set PLAYWRIGHT_BROWSERS_PATH)'

async function seedMixed() {
  await seed(account('PAAPEX3480290000007', 50000, { realized_pnl: 100, replikanto_role: 'leader' }))
  await seed(account('APEX3480290000089', 25000, { realized_pnl: -30 }))
  await seed(account('APEX3480290000090', 25000, { realized_pnl: 20, unrealized_pnl: 4 }))
  await seed(account('LFE05068171260003', 25000, { realized_pnl: 5.5 }))
}

async function openSummary() {
  const { context, page, consoleErrors } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
  await page.goto(`${APP}/summary`, { waitUntil: 'domcontentloaded' })
  await until('summary figures to render',
    async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)
  return { context, page, consoleErrors }
}

describe('daily summary page', { skip }, () => {
  test('the main dashboard has a button that opens it', async () => {
    await seedMixed()
    const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await waitForAccounts(page)
    await page.getByRole('link', { name: /daily summary/i }).click()
    await page.waitForURL(/\/summary$/)
    await until('summary to render',
      async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)
    await context.close()
  })

  test('groups PA, Apex and Lucid accounts and totals each group', async () => {
    await seedMixed()
    const { context, page, consoleErrors } = await openSummary()

    assert.equal(await page.locator('[data-testid="group-pnl-PA"]').innerText(), '+$100.00')
    assert.equal(await page.locator('[data-testid="group-pnl-APEX"]').innerText(), '-$6.00')
    assert.equal(await page.locator('[data-testid="group-pnl-LUCID"]').innerText(), '+$5.50')
    assert.equal(await page.locator('[data-testid="daily-pnl"]').innerText(), '+$99.50')

    const text = await page.locator('body').innerText()
    assert.match(text, /PA ACCOUNTS/i)
    assert.match(text, /APEX ACCOUNTS/i)
    assert.match(text, /LUCID ACCOUNTS/i)
    assert.match(text, /2 accts/)
    assert.equal(consoleErrors.length, 0, `page errors: ${consoleErrors.join(', ')}`)
    await context.close()
  })

  test('groups start collapsed and expand and collapse on tap', async () => {
    await seedMixed()
    const { context, page } = await openSummary()

    assert.doesNotMatch(await page.locator('body').innerText(), /APEX3480290000089/,
      'accounts are hidden until a group is opened')

    const apex = page.getByRole('button', { name: /apex accounts/i })
    assert.equal(await apex.getAttribute('aria-expanded'), 'false')

    await apex.click()
    assert.equal(await apex.getAttribute('aria-expanded'), 'true')
    const opened = await page.locator('body').innerText()
    assert.match(opened, /APEX3480290000089/)
    assert.match(opened, /APEX3480290000090/)
    assert.doesNotMatch(opened, /PAAPEX3480290000007/, 'other groups stay closed')

    await apex.click()
    assert.doesNotMatch(await page.locator('body').innerText(), /APEX3480290000089/)
    await context.close()
  })

  test('balances are masked until the eye is tapped', async () => {
    await seedMixed()
    const { context, page } = await openSummary()

    assert.match(await page.locator('body').innerText(), /••••••/)
    assert.doesNotMatch(await page.locator('body').innerText(), /\$125,000/)

    await page.getByRole('button', { name: /show balances/i }).click()
    assert.match(await page.locator('body').innerText(), /\$125,000/, 'total balance revealed')
    await context.close()
  })

  test('an account with an unfamiliar prefix is shown, not dropped', async () => {
    await seed(account('TPT0001', 25000, { realized_pnl: 50 }))
    await seed(account('APEX3480290000089', 25000, { realized_pnl: 10 }))
    const { context, page } = await openSummary()

    assert.equal(await page.locator('[data-testid="group-pnl-TPT"]').innerText(), '+$50.00')
    assert.equal(await page.locator('[data-testid="daily-pnl"]').innerText(), '+$60.00')
    await context.close()
  })

  test('splits realized from open, and tallies winners and losers', async () => {
    await seedMixed()
    const { context, page } = await openSummary()

    assert.equal(await page.locator('[data-testid="realized"]').innerText(), '+$95.50')
    assert.equal(await page.locator('[data-testid="open"]').innerText(), '+$4.00')
    assert.equal(await page.locator('[data-testid="leader-pnl"]').innerText(), '+$100.00')
    assert.match(await page.locator('[data-testid="tally"]').innerText(), /3 up · 1 down · 0 flat/)
    await context.close()
  })

  test('a group with a silent account says so; a healthy one does not', async () => {
    await seedMixed()
    await seed(account('APEX3480290000099', 25000, { last_update: new Date(Date.now() - 45 * 60_000).toISOString() }))
    const { context, page } = await openSummary()

    assert.match(await page.locator('[data-testid="silent-APEX"]').innerText(), /2\/3 reporting/)
    assert.equal(await page.locator('[data-testid="silent-PA"]').count(), 0)
    await context.close()
  })

  test('expand all, collapse all, and best / worst inside an open group', async () => {
    await seedMixed()
    const { context, page } = await openSummary()

    await page.getByRole('button', { name: /expand all/i }).click()
    const text = await page.locator('body').innerText()
    assert.match(text, /PAAPEX3480290000007/)
    assert.match(text, /APEX3480290000089/)
    assert.match(text, /LFE05068171260003/)
    assert.match(text, /Best\s+…0090/)
    assert.match(text, /Worst\s+…0089/)

    await page.getByRole('button', { name: /collapse all/i }).click()
    assert.doesNotMatch(await page.locator('body').innerText(), /APEX3480290000089/)
    await context.close()
  })

  test('sorting by P&L reorders the groups, and the choice survives a reload', async () => {
    await seedMixed()
    const { context, page } = await openSummary()
    const order = async () =>
      (await page.locator('button[aria-controls^="group-"]').allInnerTexts())
        .map((t) => t.split('\n').find((l) => /ACCOUNTS/i.test(l)).trim().toUpperCase())

    assert.deepEqual(await order(), ['PA ACCOUNTS', 'APEX ACCOUNTS', 'LUCID ACCOUNTS'])
    await page.getByRole('button', { name: /sort by p&l/i }).click()
    assert.deepEqual(await order(), ['PA ACCOUNTS', 'LUCID ACCOUNTS', 'APEX ACCOUNTS'])

    await page.getByRole('button', { name: /apex accounts/i }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await until('summary to render again',
      async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)
    await until('saved preferences applied',
      async () => (await page.getByRole('button', { name: /apex accounts/i }).getAttribute('aria-expanded')) === 'true')
    assert.deepEqual(await order(), ['PA ACCOUNTS', 'LUCID ACCOUNTS', 'APEX ACCOUNTS'])
    await context.close()
  })

  test('Share card hands a real PNG to the share sheet', async () => {
    await seedMixed()
    const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await page.addInitScript(() => {
      window.__shared = null
      navigator.canShare = () => true
      navigator.share = async ({ files }) => {
        const buf = new Uint8Array(await files[0].arrayBuffer())
        window.__shared = { type: files[0].type, size: buf.length, magic: Array.from(buf.slice(0, 4)) }
      }
    })
    await page.goto(`${APP}/summary`, { waitUntil: 'domcontentloaded' })
    await until('summary to render',
      async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)

    await page.getByRole('button', { name: /share card/i }).click()
    const shared = await until('image handed to the share sheet', () => page.evaluate(() => window.__shared))
    assert.equal(shared.type, 'image/png')
    assert.ok(shared.size > 5_000, `image is a real picture, not an empty file (${shared.size} bytes)`)
    assert.deepEqual(shared.magic, [0x89, 0x50, 0x4e, 0x47], 'PNG signature')
    await context.close()
  })

  // Both ways the share sheet can be unavailable must end in the same place:
  // the image on screen, to press and hold. Never a button that does nothing.
  for (const [name, stub] of [
    ['no share sheet at all', () => { Object.defineProperty(navigator, 'canShare', { value: undefined }) }],
    ['a share sheet that refuses', () => {
      navigator.canShare = () => true
      navigator.share = async () => { throw new DOMException('refused', 'NotAllowedError') }
    }],
  ]) {
    test(`${name}: the image is shown to press-and-hold, then closes`, async () => {
      await seedMixed()
      const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
      await page.addInitScript(stub)
      await page.goto(`${APP}/summary`, { waitUntil: 'domcontentloaded' })
      await until('summary to render',
        async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)

      await page.getByRole('button', { name: /share card/i }).click()
      const img = page.getByRole('img', { name: /daily p&l summary/i })
      await until('preview image to appear', async () => (await img.count()) > 0)
      await until('preview image to load',
        async () => (await img.evaluate((el) => el.complete && el.naturalWidth)) === 1080)
      assert.equal(await img.evaluate((el) => el.naturalHeight), 1350)

      await page.getByRole('dialog').click({ position: { x: 5, y: 5 } })
      await until('preview to close', async () => (await page.getByRole('dialog').count()) === 0)
      await context.close()
    })
  }

  test('closing the share sheet is not treated as a failure', async () => {
    await seedMixed()
    const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await page.addInitScript(() => {
      navigator.canShare = () => true
      navigator.share = async () => { throw new DOMException('closed', 'AbortError') }
    })
    await page.goto(`${APP}/summary`, { waitUntil: 'domcontentloaded' })
    await until('summary to render',
      async () => (await page.locator('[data-testid="daily-pnl"]').count()) > 0)

    await page.getByRole('button', { name: /share card/i }).click()
    await until('button to settle', async () => (await page.getByRole('button', { name: /share card/i }).count()) > 0)
    assert.equal(await page.getByRole('dialog').count(), 0, 'no preview after a cancel')
    assert.equal(await page.getByText('Could not create the image').count(), 0, 'no error after a cancel')
    await context.close()
  })

  test('fits a phone screen with no sideways scroll', async () => {
    await seedMixed()
    const { context, page } = await openSummary()
    await page.getByRole('button', { name: /apex accounts/i }).click()
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert.equal(overflows, false)
    await context.close()
  })
})
