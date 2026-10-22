import { createPool } from 'mysql2/promise'
import type { Env } from '../config/env.js'

export function createDatabasePool(env: Env) {
  return createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    waitForConnections: false,
    connectTimeout: 3000,
    enableKeepAlive: true,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: false,
  })
}

// Reuse any pending probe so repeated health requests cannot exhaust the pool.
export function createReadinessCheck(pool: ReturnType<typeof createDatabasePool>) {
  let pending: Promise<void> | undefined
  return async (): Promise<void> => {
    pending ??= pool.query({ sql: 'SELECT 1', timeout: 3000 })
      .then(() => undefined).finally(() => { pending = undefined })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        pending,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Database readiness timeout')), 4000) }),
      ])
    } finally { clearTimeout(timer) }
  }
}
