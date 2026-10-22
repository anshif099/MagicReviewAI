# Backend foundation

Requires Node.js 24. Install from the repository root with `npm ci`; the repository uses a single root lockfile.

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and replace the database placeholders with your own MySQL/MariaDB connection details. Do not commit this file.
2. Run `npm run dev:api` from the repository root. Run the existing `npm run dev` in another terminal for the unchanged frontend.
3. Check `http://127.0.0.1:3001/health/live` and `/health/ready`.

The backend loads only `backend/.env`, resolved relative to its own modules in both source and compiled builds. Existing environment variables take priority. The frontend does not read this file and does not make API calls in this phase. Never put database values in `VITE_*` variables.

## Configuration

| Variable | Meaning |
| --- | --- |
| NODE_ENV | development (default), test, or production |
| HOST | Bind interface; defaults to 127.0.0.1 locally. Confirm Hostinger's required interface before deployment. |
| PORT | HTTP port, 1–65535; defaults to 3001. Honor the hosting-assigned value. |
| CORS_ORIGINS | Required comma-separated exact HTTP(S) frontend origins, without trailing slashes, paths, credentials, or wildcards |
| DB_HOST / DB_PORT | Database hostname and port; port defaults to 3306 |
| DB_NAME / DB_USER / DB_PASSWORD | Required database credentials; example placeholders are rejected |
| DB_CONNECTION_LIMIT | Pool size, 1–50; defaults to 5. Match the hosting database allowance. |

CORS allows only GET/HEAD/OPTIONS and Content-Type; credentials are disabled. Disallowed browser origins receive 403. Requests without Origin remain valid for health probes and server-to-server access; CORS is not authentication.

## Health and lifecycle

- `GET /health/live`: 200 if HTTP is responding; no database query.
- `GET /health/ready`: 200 after a successful `SELECT 1`; 503 if the database is unavailable, times out, or shutdown has begun. No connection details are returned.
- Configuration errors stop startup with exit code 1 and variable names only. A database outage does not prevent HTTP startup.
- Probes have a four-second response deadline and share an in-flight query. The pool has bounded connections and does not queue requests when exhausted.
- SIGINT/SIGTERM marks the service unready, stops accepting HTTP connections, drains active requests, and closes the pool. A ten-second deadline forces exit if cleanup hangs.
- Express uses Helmet, a 16 KB JSON body limit, centralized safe errors, and no x-powered-by header. HTTP request/header timeouts are configured independently of database timeouts.

## Commands

From the repository root:

```text
npm run typecheck:api
npm run build:api
npm run start:api
npm run test --workspace backend
```

Backend tests compile first and use Node's built-in test runner. They exercise HTTP behavior with an injected database probe, environment validation, query deduplication, startup failure, unavailable database behavior, and the real shutdown handler. A successful readiness response against a real database still requires a configured MySQL/MariaDB instance.

## Before deployment

Confirm Hostinger's Node 24 runtime, monorepo build root, compiled entrypoint (`backend/dist/server.js` relative to repository root), environment-variable controls, required bind address/port, HTTPS/API domain, and log access. Confirm the actual MariaDB/MySQL version, database network location, TLS requirements, allowed connections, and backups. TLS must be configured with a verified CA if the database requires a remote TLS connection; this local foundation does not assume a remote database transport configuration.

Keep the current frontend deployment unchanged. `npm run build` still builds only the frontend; `npm run build:api` builds only the backend. Install dev dependencies during backend builds so the compiler is available; run compiled JavaScript in production. No PM2, background workers, authentication, migrations, or business routes are included.
