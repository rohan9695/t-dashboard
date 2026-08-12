// test/run.mjs
// Boots a self-contained sandbox — mock Supabase, mock ntfy, and the real
// Next.js app pointed at both — runs the suites against it, then tears
// everything down.
//
//   npm test              unit + integration
//   npm run test:unit     pure logic only, no server, ~300ms
//   npm run sandbox       boot it and leave it running to click around
//
// Nothing here touches your real Supabase, Cloudflare, or phone.

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { networkInterfaces } from 'node:os'

const DB_PORT   = 54321
const NTFY_PORT = 8099
const APP_PORT  = 3100 // deliberately not 3000, so `npm run dev` can stay up

const SANDBOX_ONLY = process.argv.includes('--sandbox')
const SKIP_BUILD   = process.argv.includes('--skip-build')

const env = {
  ...process.env,
  // Point the app at the mocks. NEXT_PUBLIC_* is inlined at build time, which
  // is why a build is required when these change.
  NEXT_PUBLIC_SUPABASE_URL:      `http://127.0.0.1:${DB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY:     'test-service-key',
  API_KEY:                       'test-api-key',
  NTFY_SERVER:                   `http://127.0.0.1:${NTFY_PORT}`,
  NTFY_TOPIC:                    'test-topic',
  PORT:                          String(APP_PORT),
  // Enables /api/auth/sandbox-login so a phone on the same network can get past
  // the Face ID gate. Never set by a deploy — see that route for the second gate.
  SANDBOX_MODE:                  '1',
  // Bind all interfaces so the phone can reach it; 127.0.0.1 only would not.
  HOSTNAME:                      '0.0.0.0',
}

/** First non-internal IPv4 address, i.e. the one a phone can reach. */
function lanAddress() {
  const nets = networkInterfaces()
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

const children = []
let shuttingDown = false

function start(name, cmd, args, opts = {}) {
  // detached puts the child in its own process GROUP, which is what makes a
  // complete teardown possible below. `npm run start` spawns next-server as a
  // GRANDCHILD, so killing the npm process alone left next-server alive and
  // still holding port 3100 after every run — the source of every stale-port
  // failure in this sandbox.
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts })
  children.push({ name, child })
  const tag = `[${name}]`
  child.stdout.on('data', (d) => process.env.TEST_VERBOSE && process.stdout.write(`${tag} ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`))
  return child
}

/**
 * Refuses to start when something already owns a sandbox port.
 *
 * Without this the run limps on instead of stopping: the child prints
 * EADDRINUSE and dies, waitFor() is satisfied by the STALE server already
 * listening there, and the whole suite then runs against a previous build.
 * That produced 48 failures across unrelated suites with the real cause —
 * one line — buried in the middle of the log. A suite that reports the wrong
 * answer is worse than one that refuses to run.
 */
async function assertPortFree(label, port) {
  // A raw TCP connect, NOT an HTTP request. The first version of this check
  // used fetch(), which cannot see a socket that is bound but not answering —
  // a half-dead next-server holds the port, the request times out, the catch
  // reports "free", and the bind fails anyway. A check that silently passes
  // when it cannot measure is worse than no check, because it is believed.
  const held = await new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (result) => { sock.destroy(); resolve(result) }
    sock.setTimeout(1_000)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(true))  // listening but not talking still owns the port
    sock.once('error', () => done(false))   // ECONNREFUSED — genuinely free
  })
  if (!held) return

  throw new Error(
    `${label} port ${port} is already in use — a previous sandbox is probably still running.\n` +
    `Find and stop it with:  lsof -ti tcp:${port} | xargs kill -9\n` +
    `If lsof reports nothing, the holder may be a half-dead next-server; find it with:\n` +
    `  for d in /proc/[0-9]*; do tr '\\0' ' ' < $d/cmdline | grep -q next-server && echo \${d#/proc/}; done`,
  )
}

async function waitFor(label, url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${label} did not come up at ${url} within ${timeoutMs}ms`)
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    // Negative pid = the whole process group, so grandchildren die too.
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
}
process.on('exit', shutdown)
process.on('SIGINT', () => { shutdown(); process.exit(130) })
process.on('SIGTERM', () => { shutdown(); process.exit(143) })

async function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { env, stdio: 'inherit', ...opts })
  const [code] = await once(child, 'exit')
  return code ?? 1
}

// ── boot ────────────────────────────────────────────────────────────────────
console.log('Starting sandbox…')

// Check every port before spawning anything, so a stale sandbox is reported
// once and clearly rather than as a wall of downstream failures.
await assertPortFree('mock supabase', DB_PORT)
await assertPortFree('mock ntfy', NTFY_PORT)
await assertPortFree('app', APP_PORT)

start('mock-supabase', process.execPath, ['test/mocks/supabase.mjs', String(DB_PORT)])
start('mock-ntfy',     process.execPath, ['test/mocks/ntfy.mjs', String(NTFY_PORT)])
await waitFor('mock supabase', `http://127.0.0.1:${DB_PORT}/__health`, 10_000)
await waitFor('mock ntfy',     `http://127.0.0.1:${NTFY_PORT}/__health`, 10_000)
console.log('  mocks up')

if (!SKIP_BUILD) {
  // Required because NEXT_PUBLIC_* values are baked in at build time.
  // NOTE: this overwrites .next with a sandbox build. Deploys run their own
  // build, so this only affects a local `npm start`.
  console.log('  building app against the mocks (overwrites .next)…')
  const code = await run('npm', ['run', 'build'], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (code !== 0) { console.error('build failed'); process.exit(code) }
}

start('app', 'npm', ['run', 'start'])
await waitFor('app', `http://127.0.0.1:${APP_PORT}/`)
console.log(`  app up on http://127.0.0.1:${APP_PORT}`)

// ── sandbox mode: seed demo data and stay up ────────────────────────────────
if (SANDBOX_ONLY) {
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const demo = [
    ['PAAPEX3480290000007', 50088.64, 240.26, 'leader'],
    ['APEX3480290000089', 48929.70, -493.02, null],
    ['APEX3480290000090', 49784.54, -1096.60, null],
    ['APEX3480290000091', 47946.54, -968.10, null],
    ['APEX3480290000092', 47999.22, -109.20, null],
  ]
  for (const [id, bal, realized, role] of demo) {
    await fetch(`http://127.0.0.1:${DB_PORT}/__seed`, {
      method: 'POST',
      body: JSON.stringify({
        account_id: id, total_available: bal, net_liq: bal, realized_pnl: realized,
        dollar_open: 0, unrealized_pnl: 0, drawdown_auto: 48000, trailing_max: 2000,
        dist_drawdown: Math.max(0, bal - 48000),
        dist_to_daily_loss: Math.max(0, 1000 - Math.max(0, 50000 - bal)),
        peak_balance: 50000, day_start_balance: 50000, day_date: today,
        source: 'ninjatrader', nt_fields: ['total_available', 'realized_pnl'],
        last_update: new Date().toISOString(), status: 'active', hidden: false,
        last_batch_ts: 1000, replikanto_role: role,
      }),
    })
  }

  const lan = lanAddress()
  console.log(`
  Sandbox ready — nothing here touches production.

    On this machine   http://127.0.0.1:${APP_PORT}
${lan ? `    On your phone     http://${lan}:${APP_PORT}/api/auth/sandbox-login
                      (same Wi-Fi. Open that exact URL once — it unlocks the
                       Face ID gate, which cannot run over plain HTTP, then
                       redirects to the dashboard.)
` : '    On your phone     no LAN address detected\n'}
    Notifications     http://127.0.0.1:${NTFY_PORT}/__notifications
    Stored rows       http://127.0.0.1:${DB_PORT}/__accounts

  Fire a partial fill and watch the alert:

    curl -X POST http://127.0.0.1:${APP_PORT}/api/trade-event \\
      -H 'X-Api-Key: test-api-key' -H 'Content-Type: application/json' \\
      -d '{"symbol":"ES","direction":"long","accounts":["PAAPEX3480290000007"],"total_accounts":5}'

  Ctrl-C to stop.
`)
  await new Promise(() => {}) // stay up
}

// ── run the suites ──────────────────────────────────────────────────────────
console.log('\nRunning tests…\n')
// --test-concurrency=1 is required, not a preference: the suites share one
// mock backend, and Node runs test FILES in parallel by default, so two files
// would reset each other's fixtures mid-test and fail at random.
const code = await run(process.execPath, [
  '--test',
  '--test-concurrency=1',
  'test/unit/*.test.mjs',
  'test/integration/*.test.mjs',
])

shutdown()
process.exit(code)
