import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import type { Env } from './config/env.js'
import { errorHandler, HttpError } from './middleware/error-handler.js'

type Dependencies = {
  env: Env
  isShuttingDown: () => boolean
  checkDatabase: () => Promise<void>
}

export function createApp({ env, isShuttingDown, checkDatabase }: Dependencies) {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      // No Origin header is normal for health probes and server-to-server calls.
      // CORS is a browser policy, not authentication or API authorization.
      if (!origin) { callback(null, false); return }
      if (env.CORS_ORIGINS.includes(origin)) { callback(null, true); return }
      callback(new HttpError(403, 'Origin is not allowed'))
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 600,
  }))
  app.use(express.json({ limit: '16kb' }))
  app.get('/health/live', (_request, response) => {
    response.set('Cache-Control', 'no-store').status(200).json({ status: 'alive' })
  })
  app.get('/health/ready', async (_request, response) => {
    response.set('Cache-Control', 'no-store')
    if (isShuttingDown()) {
      response.status(503).json({ status: 'not_ready', database: 'unchecked' })
      return
    }
    try {
      await checkDatabase()
      response.status(isShuttingDown() ? 503 : 200).json({ status: isShuttingDown() ? 'not_ready' : 'ready', database: 'up' })
    } catch {
      response.status(503).json({ status: 'not_ready', database: 'unavailable' })
    }
  })
  app.use((_request, _response, next) => next(new HttpError(404, 'Not found')))
  app.use(errorHandler)
  return app
}
