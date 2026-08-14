// test/integration/health.test.mjs
// The endpoint exists to diagnose a host nobody can otherwise diagnose, so the
// things worth pinning are: it answers without auth, it names what is missing,
// and it never leaks a value.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { APP } from '../helpers.mjs'

describe('/api/health', () => {
  test('answers without any credentials', async () => {
    // On a host where API_KEY is unset, an authenticated health check would be
    // unreachable exactly when it is needed.
    const res = await fetch(`${APP}/api/health`)
    assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`)
    const body = await res.json()
    assert.equal(typeof body.ok, 'boolean')
    assert.ok(Array.isArray(body.missing))
  })

  test('reports every required variable as a boolean, never a value', async () => {
    const body = await (await fetch(`${APP}/api/health`)).json()
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY', 'API_KEY',
    ]) {
      assert.equal(typeof body.config[name], 'boolean', `${name} must be a boolean`)
    }
    // Check the actual VALUES never appear, rather than pattern-matching for
    // secret-looking text: the first version of this matched /service_role/i
    // against the variable NAME in the config object and failed on a correct
    // response. These are the values test/run.mjs configures the sandbox with,
    // so if any leaks it shows up here verbatim.
    const serialised = JSON.stringify(body)
    for (const value of ['test-service-key', 'test-api-key', 'test-anon-key', 'test-topic']) {
      assert.ok(!serialised.includes(value), `leaked the value of a configured variable: ${value}`)
    }
    assert.doesNotMatch(serialised, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT-shaped material')
  })

  test('a NEXT_PUBLIC value with a code fallback does not fail the host', async () => {
    // These are inlined at build time and have hardcoded fallbacks in
    // lib/supabase/{client,server}.ts, so a host without them still serves.
    // Treating them as required reported a healthy Cloudflare deploy as broken
    // — a monitor that cries wolf is one you learn to ignore.
    const body = await (await fetch(`${APP}/api/health`)).json()
    assert.ok(!body.missing.includes('NEXT_PUBLIC_SUPABASE_URL'))
    assert.ok(!body.missing.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
    // Still reported, so "off on purpose" stays distinguishable from "forgotten".
    assert.equal(typeof body.config.NEXT_PUBLIC_SUPABASE_URL, 'boolean')
  })

  test('a configured host reports ok with a live database round trip', async () => {
    // The sandbox sets every variable, so this is the healthy path.
    const res = await fetch(`${APP}/api/health`)
    const body = await res.json()
    assert.deepEqual(body.missing, [], `unexpectedly missing: ${body.missing}`)
    assert.equal(body.database, 'ok', 'a present key must also actually work')
    assert.equal(body.ok, true)
    assert.equal(res.status, 200)
  })
})
