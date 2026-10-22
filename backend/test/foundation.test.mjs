import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createApp } from '../dist/app.js'
import { loadEnv } from '../dist/config/env.js'
import { createReadinessCheck } from '../dist/db/pool.js'

const env = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 3001,
  CORS_ORIGINS: ['http://localhost:5173'], DB_HOST: '127.0.0.1',
  DB_PORT: 1, DB_NAME: 'test_only', DB_USER: 'test_only',
  DB_PASSWORD: 'test_only_not_a_credential', DB_CONNECTION_LIMIT: 1,
}

test('health, CORS, parser errors, security headers, and 404 responses', async () => {
  let databaseUp = true
  let draining = false
  const server = createServer(createApp({ env, isShuttingDown: () => draining, checkDatabase: async () => {
    if (!databaseUp) throw new Error('sensitive database details')
  } }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    let response = await fetch(`${base}/health/live`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    response = await fetch(`${base}/health/ready`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ready', database: 'up' })
    databaseUp = false
    response = await fetch(`${base}/health/ready`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'not_ready', database: 'unavailable' })
    assert.equal((await fetch(`${base}/health/live`)).status, 200)
    draining = true
    response = await fetch(`${base}/health/ready`)
    assert.deepEqual(await response.json(), { status: 'not_ready', database: 'unchecked' })
    response = await fetch(`${base}/health/live`, { headers: { Origin: 'http://localhost:5173' } })
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
    response = await fetch(`${base}/health/live`, { headers: { Origin: 'https://untrusted.example' } })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
    response = await fetch(`${base}/health/live`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } })
    assert.equal(response.status, 204)
    response = await fetch(`${base}/missing`)
    assert.equal(response.status, 404)
    response = await fetch(`${base}/missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":' })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Invalid request body' })
    response = await fetch(`${base}/missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'a'.repeat(17000) }) })
    assert.equal(response.status, 413)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('environment validation rejects missing values, placeholders, invalid ports and wildcard origins without exposing values', () => {
  const previous = { ...process.env }
  try {
    Object.assign(process.env, { ...env, CORS_ORIGINS: 'http://localhost:5173' })
    assert.equal(loadEnv().DB_CONNECTION_LIMIT, 1)
    delete process.env.DB_PASSWORD
    assert.throws(() => loadEnv(), /DB_PASSWORD/)
    process.env.DB_PASSWORD = 'REPLACE_WITH_DATABASE_PASSWORD'
    assert.throws(() => loadEnv(), /DB_PASSWORD/)
    process.env.DB_PASSWORD = env.DB_PASSWORD
    process.env.PORT = '70000'
    process.env.CORS_ORIGINS = '*'
    assert.throws(() => loadEnv(), error => error.message.includes('PORT') && error.message.includes('CORS_ORIGINS') && !error.message.includes(env.DB_PASSWORD))
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test('concurrent readiness probes share one database query', async () => {
  let queries = 0
  let complete
  const query = new Promise(resolve => { complete = resolve })
  const check = createReadinessCheck({ query() { queries++; return query } })
  const first = check()
  const second = check()
  assert.equal(queries, 1)
  complete([])
  await Promise.all([first, second])
})

test('production entrypoint fails clearly when configuration is missing', async () => {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DB_PASSWORD: '', CORS_ORIGINS: '' },
  })
  let output = ''
  child.stderr.on('data', data => { output += data })
  const [code] = await once(child, 'exit')
  assert.equal(code, 1)
  assert.match(output, /Missing or invalid environment variables/)
  assert.match(output, /DB_PASSWORD/)
})

test('real server starts with an unavailable database and handles graceful SIGTERM shutdown', { timeout: 15000 }, async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  // IPC triggers the real signal handler on Windows, where child.kill force-terminates.
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import './dist/server.js'; process.on('message', () => { process.disconnect(); process.emit('SIGTERM') })"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...Object.fromEntries(Object.entries(env).map(([key,value]) => [key, String(value)])), CORS_ORIGINS: env.CORS_ORIGINS.join(','), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  try {
    await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', code => reject(new Error(`Server exited early: ${code}`)))
      child.stdout.on('data', data => { output += data; if (output.includes('Backend listening')) resolve() })
    })
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/live`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 503)
    const exited = once(child, 'exit')
    child.send('shutdown')
    const [code] = await exited
    assert.equal(code, 0)
    assert.match(output, /shutting down \(SIGTERM\)/)
  } finally { if (child.exitCode === null) child.kill() }
})
