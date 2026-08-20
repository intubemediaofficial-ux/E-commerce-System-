# Inventory Management System (E-commerce + Restaurant)

Multi-tenant inventory platform with a ledger-backed stock core, restaurant recipe
consumption and e-commerce reservation/fulfilment flows.

- `apps/api` — Express + TypeScript REST API, Prisma/PostgreSQL, Redis + BullMQ jobs, Swagger docs
- `apps/web` — Next.js 14 App Router frontend (TanStack Query, Tailwind), fully responsive

## Core guarantees

- Every physical stock movement writes an immutable `inventory_ledger` row; ledger rows are never
  updated or deleted.
- Stock mutations run inside a transaction with `SELECT ... FOR UPDATE` on the stock row, so
  concurrent orders cannot oversell.
- `available = quantity - reserved`; stock cannot go negative unless the organization enables it.
- Reservations are separate from physical quantity: confirmation reserves, shipment consumes,
  cancellation releases, returns restock only after validation.
- Costing supports weighted-average and FIFO valuation; batch consumption can follow FEFO.
- Inventory-mutating endpoints accept an `Idempotency-Key` header and replay the first result.
- Every organization's data is scoped by `organizationId`; sensitive operations are audited.

## Quick start (local)

```bash
cp .env.example .env                # then edit secrets
docker run -d --name ims-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ims -p 5432:5432 postgres:16-alpine
docker run -d --name ims-redis -p 6379:6379 redis:7-alpine

npm install
npm run db:migrate --workspace=api
npm run db:seed --workspace=api

npm run dev                         # api on :4000, web on :3000
npm run worker --workspace=api      # background jobs (optional)
```

Seed logins (development data only):

| Role | Email | Password |
| --- | --- | --- |
| Super admin | superadmin@demo.test | Admin@12345 |
| Admin (full access) | admin@demo.test | Admin@12345 |

Other seeded users cover inventory manager, purchase manager, restaurant manager, kitchen staff,
sales manager and accountant roles.

## Verification

```bash
npm run lint
npm run typecheck
npm test          # unit + integration (needs Postgres/Redis and a seeded database)
npm run build
```

API health and documentation:

- `GET /health`, `GET /health/ready`
- `GET /api/docs` (Swagger UI), `GET /api/openapi.json`

## Docker

```bash
JWT_SECRET=... JWT_REFRESH_SECRET=... docker compose up --build
docker compose exec api npx prisma db seed   # optional demo data
```

Compose starts PostgreSQL, Redis, the API (runs `prisma migrate deploy` on boot), the BullMQ
worker and the frontend.

## Modules

| Area | Highlights |
| --- | --- |
| Auth | login/refresh/logout, refresh-token rotation, forgot/reset/change password, Argon2 hashing |
| RBAC | permission catalog, system + custom roles, Admin/Super Admin full bypass |
| Master data | organizations, locations, warehouses, categories, brands, units + conversions, products, variants, bundles, suppliers |
| Inventory | stock, immutable ledger, batches/expiry, adjustments (with high-value approval), transfers, wastage, opening-stock CSV import, barcode/SKU lookup |
| Purchasing | purchase orders with approval workflow, partial goods receipts with batch capture, purchase returns, supplier price history |
| Restaurant | recipes/BOM with yield + wastage %, recipe costing, kitchen orders, automatic ingredient consumption, manual consumption, food cost |
| E-commerce | orders, reservations with TTL, bundle expansion, pack/ship/complete/cancel, validated returns |
| Analytics | admin/inventory/restaurant/e-commerce dashboards, 20 reports with JSON/CSV/Excel/PDF export |
| Notifications | low stock, out of stock, expiry, large wastage; in-app + email, recurring BullMQ jobs |
| Audit | immutable audit log with actor, IP, user agent and before/after values |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment variables, migrations, backups,
monitoring and logging guidance.
