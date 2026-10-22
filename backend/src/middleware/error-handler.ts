import type { ErrorRequestHandler } from 'express'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) { next(error); return }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message })
    return
  }
  // Parser errors get fixed public messages, never the raw body or error details.
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
  if (status === 400 || status === 413 || status === 415) {
    response.status(status).json({ error: status === 413 ? 'Request body too large' : 'Invalid request body' })
    return
  }
  console.error('Unhandled request error; details withheld to protect sensitive data.')
  response.status(500).json({ error: 'Internal server error' })
}
