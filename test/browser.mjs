// test/browser.mjs
// Finds a Chromium to drive, and opens the dashboard already unlocked.
//
// playwright-core ships no browsers on purpose — a 150MB download is not worth
// it when every machine here already has one. Resolution order:
//   1. PLAYWRIGHT_BROWSERS_PATH  (CI images, this dev container)
//   2. an installed Chrome, then Edge  (a normal Windows/Mac machine)
// If none is found the UI suite skips rather than fails, so `npm test` still
// works on a machine with no browser at all.

import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function findBrowser() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(root, dir, rel)
        if (existsSync(p)) return { executablePath: p }
      }
    }
  }
  for (const channel of ['chrome', 'msedge']) {
    try {
      chromium.executablePath({ channel })
      return { channel }
    } catch { /* not installed */ }
  }
  return null
}

// ── session cookie ──────────────────────────────────────────────────────────
// The dashboard is behind a Face ID gate that passes as soon as a valid
// td_session cookie exists. AUTH_JWT_SECRET falls back to the last dot-segment
// of SUPABASE_SERVICE_ROLE_KEY, which the sandbox sets to a known test value.
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

export async function signSession(secret, ttlSeconds = 86_400) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(JSON.stringify({ sub: 'sandbox', iat: now, exp: now + ttlSeconds }))
  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

/**
 * Polls until `check()` is truthy, or throws with `label`.
 *
 * Fixed sleeps are why the browser suite passed locally and failed on CI: a
 * slower runner simply had not finished rendering when the assertion ran. Wait
 * for the condition, not for the clock.
 */
export async function until(label, check, { timeout = 20_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await check()
      if (last) return last
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`timed out after ${timeout}ms waiting for: ${label}`)
}

/** Waits until the dashboard has painted real account rows AND their figures. */
export async function waitForAccounts(page, { timeout = 25_000 } = {}) {
  return until(
    'account rows and their figures to render',
    async () => {
      const text = await page.locator('body').innerText()
      // "Nothing to show" is a settled state too.
      if (/No accounts connected/.test(text)) return true
      // An account id alone is not enough: the id can paint from the server
      // render while the figures are still a poll behind, which had a test
      // assert on a balance that had not arrived yet. Require a formatted
      // currency value as well, so the row is genuinely complete.
      return /APEX|PAAPEX/.test(text) && /\$[\d,]+\.\d{2}/.test(text)
    },
    { timeout },
  )
}

/** An iPhone-sized page with the gate already satisfied. */
export async function openDashboard(browser, { appUrl, secret, viewMode = 'card' } = {}) {
  const token = await signSession(secret)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14/15
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const host = new URL(appUrl).hostname
  await context.addCookies([{ name: 'td_session', value: token, domain: host, path: '/' }])
  await context.addInitScript((mode) => {
    localStorage.setItem('td_view_mode', mode)
  }, viewMode)

  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  return { context, page, consoleErrors }
}
