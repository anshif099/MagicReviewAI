import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadEnv } from './config/env.js'
import { createDatabasePool, createReadinessCheck } from './db/pool.js'

async function main() {
  const env = loadEnv()
  const pool = createDatabasePool(env)
  let shuttingDown = false
  const app = createApp({ env, checkDatabase: createReadinessCheck(pool), isShuttingDown: () => shuttingDown })
  const server = createServer(app)
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.keepAliveTimeout = 5000

  async function shutdown(reason: string, exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    process.exitCode = exitCode
    console.info(`Backend shutting down (${reason}).`)
    const deadline = setTimeout(() => {
      console.error('Shutdown deadline exceeded; forcing exit.')
      server.closeAllConnections()
      process.exit(1)
    }, 10_000)
    try {
      // Drain active HTTP requests before closing connections they may be using.
      await new Promise<void>(resolve => { server.close(() => resolve()) })
      await pool.end()
    } catch {
      console.error('Backend resource cleanup failed.')
      process.exitCode = 1
    } finally { clearTimeout(deadline) }
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  server.on('error', () => { console.error('HTTP server failed to start or run; check HOST and PORT.'); void shutdown('HTTP error', 1) })
  server.listen(env.PORT, env.HOST, () => {
    console.info(`Backend listening on ${env.HOST}:${env.PORT}; database readiness is checked separately.`)
  })
}

main().catch(error => {
  // Configuration errors contain variable names only, never their values.
  console.error(error instanceof Error ? error.message : 'Backend startup failed.')
  process.exitCode = 1
})
