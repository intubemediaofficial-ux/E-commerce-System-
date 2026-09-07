# Deployment guide

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma. |
| `JWT_SECRET` | yes | Access-token signing secret (rotate per environment). |
| `JWT_REFRESH_SECRET` | yes | Refresh-token signing secret, must differ from `JWT_SECRET`. |
| `JWT_ACCESS_TTL` | no | Access token lifetime, default `15m`. |
| `JWT_REFRESH_TTL` | no | Refresh token lifetime, default `30d`. |
| `PORT` | no | API port, default `4000`. |
| `NODE_ENV` | no | `development` / `production`. |
| `SEED_PASSWORD` | production seed only | Strong private password required when explicitly loading demo data in production. |
| `CORS_ORIGINS` | no | Comma-separated allowed origins for the browser app. |
| `LOG_LEVEL` | no | Pino level, default `info`. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | no | API rate limiting window and cap. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | no | Object storage for product images. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | no | Outbound email for password resets. |
| `NEXT_PUBLIC_API_URL` | yes (web) | Public API base URL baked into the frontend build. |

Never commit real secrets. `.env.example` documents every key; supply values through your
secret manager or CI/CD environment.

## Database migrations

```bash
npm run db:migrate --workspace=api        # prisma migrate deploy (production)
npm run db:migrate:dev --workspace=api    # create a new migration during development
npm run db:seed --workspace=api           # development/demo data only
```

Migrations are checked into `apps/api/prisma/migrations` and must be applied before the API
starts. The Compose `api` service runs `prisma migrate deploy` on boot.

The seed creates predictable demo accounts and must not use its development password in production.
If production demo data is explicitly required, set `NODE_ENV=production` and a strong, private
`SEED_PASSWORD` before running the seed. The seed refuses to run in production without it.

## Processes

| Process | Command | Notes |
| --- | --- | --- |
| API | `node dist/server.js` | Stateless, scale horizontally behind a load balancer. |
| Web | `node apps/web/server.js` | Next.js standalone output. |

## Backups

- Take nightly `pg_dump` snapshots plus continuous WAL archiving (or managed PITR).
- Verify restores monthly into a scratch database and run `prisma migrate status` against it.
- Never restore a production dump into a shared development database — it contains tenant data.

## Monitoring

- Liveness: `GET /health`. Readiness (database): `GET /health/ready`.
- Track API latency (target < 500 ms for list queries) and the 5xx rate.

## Logging

- Structured JSON via Pino, with request logging through `pino-http`.
- Passwords, access tokens, refresh tokens and payment data are never logged.
- Ship logs to your aggregator and retain audit logs (`audit_logs` table) for compliance; they are
  append-only and should never be pruned without an approved retention policy.

## Hardening checklist

- Terminate TLS at the edge; the API sets HSTS and secure headers via Helmet.
- Keep rate limiting enabled and tighten `CORS_ORIGINS` to known frontends.
- Rotate JWT secrets on a schedule; refresh tokens are rotated and revocable per session.
- Restrict database credentials to the application role only, with no DDL rights in production
  beyond migration jobs.
