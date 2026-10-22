import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

// Resolve only the backend .env, regardless of the process working directory.
// Host-provided environment variables retain priority over the local file.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

const required = z.string().min(1).refine(value => !value.startsWith('REPLACE_WITH_'))
const integer = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback)
const origins = z.string().min(1).transform(value => value.split(',').map(origin => origin.trim()))
  .refine(values => values.every(origin => {
    try {
      const url = new URL(origin)
      return ['http:', 'https:'].includes(url.protocol) && url.origin === origin
    } catch { return false }
  }))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: integer(3001, 65535),
  CORS_ORIGINS: origins,
  DB_HOST: required,
  DB_PORT: integer(3306, 65535),
  DB_NAME: required,
  DB_USER: required,
  DB_PASSWORD: required,
  DB_CONNECTION_LIMIT: integer(5, 50),
})

export type Env = z.infer<typeof schema>

export function loadEnv(): Env {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    // Never include input values: they may contain credentials.
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))]
    throw new Error(`Missing or invalid environment variables: ${fields.join(', ')}. Check backend/.env.example; numeric values must be positive integers within their limits and CORS_ORIGINS must contain exact HTTP(S) origins.`)
  }
  return result.data
}
