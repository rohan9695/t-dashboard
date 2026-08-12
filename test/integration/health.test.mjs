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
      'SUPABASE_SERVICE_ROLE_KEY', 'API_KEY', 'NTFY_TOPIC',
    ]) {
      assert.equal(typeof body.config[name], 'boolean', `${name} must be a boolean`)
    }
    // Nothing in the response may resemble a credential.
    const serialised = JSON.stringify(body)
    assert.doesNotMatch(serialised, /eyJ|service_role|sk-|supabase\.co/i, 'no secret material in the reply')
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
