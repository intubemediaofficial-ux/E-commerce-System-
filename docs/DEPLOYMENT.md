# Deployment guide

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma. |
| `REDIS_URL` | yes | Redis connection for BullMQ queues and idempotency helpers. |
| `JWT_SECRET` | yes | Access-token signing secret (rotate per environment). |
| `JWT_REFRESH_SECRET` | yes | Refresh-token signing secret, must differ from `JWT_SECRET`. |
| `JWT_ACCESS_TTL` | no | Access token lifetime, default `15m`. |
| `JWT_REFRESH_TTL` | no | Refresh token lifetime, default `30d`. |
| `PORT` | no | API port, default `4000`. |
| `NODE_ENV` | no | `development` / `production`. |
| `CORS_ORIGINS` | no | Comma-separated allowed origins for the browser app. |
| `LOG_LEVEL` | no | Pino level, default `info`. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | no | API rate limiting window and cap. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | no | Object storage for images, invoices and exported reports. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | no | Outbound email for notifications and password resets. |
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

## Processes

| Process | Command | Notes |
| --- | --- | --- |
| API | `node dist/server.js` | Stateless, scale horizontally behind a load balancer. |
| Worker | `node dist/jobs/worker.js` | Runs low-stock/expiry/reservation-expiry jobs; run exactly one replica per queue unless jobs are idempotent. |
| Web | `node apps/web/server.js` | Next.js standalone output. |

## Backups

- Take nightly `pg_dump` snapshots plus continuous WAL archiving (or managed PITR).
- Verify restores monthly into a scratch database and run `prisma migrate status` against it.
- Redis holds queues and idempotency records only; it can be rebuilt, but enable AOF so in-flight
  jobs survive a restart.
- Never restore a production dump into a shared development database — it contains tenant data.

## Monitoring

- Liveness: `GET /health`. Readiness (DB + Redis): `GET /health/ready`.
- Track API latency (target < 500 ms for list queries), 5xx rate, queue depth and job failures.
- Alert on inventory-specific signals: failed stock mutations, adjustments awaiting approval,
  reservations expiring in bulk and negative-stock rejections.

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
