// test/integration/order.ui.test.mjs
// Row order on the main dashboard: leader, the pinned live account, PA accounts,
// then everyone else. Skips when no Chromium is available.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findBrowser, openDashboard, waitForAccounts } from '../browser.mjs'
import { account, resetAll, seed, APP } from '../helpers.mjs'

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-service-key'
const found = findBrowser()
let browser = null

before(async () => { if (found) browser = await chromium.launch(found) })
after(async () => { if (browser) await browser.close() })
beforeEach(resetAll)

const skip = found ? false : 'no Chromium found (install Chrome, or set PLAYWRIGHT_BROWSERS_PATH)'
const quiet = () => new Date(Date.now() - 45 * 60_000).toISOString()

describe('main dashboard order', { skip }, () => {
  test('leader, pinned account, PA accounts, then the rest — offline never outranks them', async () => {
    await seed(account('APEX3480290000089', 25000))
    await seed(account('LFE05068171260003', 25000))
    await seed(account('PAAPEX3480290000010', 50000))
    await seed(account('PAAPEX3480290000005', 50000))
    await seed(account('APEX3480290000001', 25000))
    await seed(account('APEX2330283000044', 25000))
    await seed(account('PAAPEX3480290000099', 50000, { replikanto_role: 'leader' }))
    await seed(account('PAAPEX3480290000020', 50000, { last_update: quiet() }))
    await seed(account('APEX3480290000002', 25000, { last_update: quiet() }))

    const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await waitForAccounts(page)
    const text = await page.locator('body').innerText()

    const want = [
      'PAAPEX3480290000099', // leader
      'APEX2330283000044',   // pinned, right after the leader
      'PAAPEX3480290000005', // PA, online, by id
      'PAAPEX3480290000010',
      'PAAPEX3480290000020', // PA but quiet: still above every non-PA account
      'APEX3480290000001',   // everyone else, online first, then by id
      'APEX3480290000089',
      'LFE05068171260003',
      'APEX3480290000002',   // non-PA and quiet: last
    ]
    const pos = want.map((id) => text.indexOf(id))
    assert.ok(pos.every((p) => p >= 0), `every account is shown: ${JSON.stringify(pos)}`)
    assert.deepEqual([...pos].sort((a, b) => a - b), pos, `rows are in the expected order: ${want.join(' > ')}`)
    await context.close()
  })

  test('with no pinned account and no PA accounts the order is unchanged', async () => {
    await seed(account('LFE05068171260003', 25000))
    await seed(account('APEX3480290000089', 25000))
    await seed(account('APEX3480290000001', 25000))

    const { context, page } = await openDashboard(browser, { appUrl: APP, secret: SECRET })
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await waitForAccounts(page)
    const text = await page.locator('body').innerText()
    const pos = ['APEX3480290000001', 'APEX3480290000089', 'LFE05068171260003'].map((id) => text.indexOf(id))
    assert.deepEqual([...pos].sort((a, b) => a - b), pos)
    assert.ok(pos[0] >= 0)
    await context.close()
  })
})
