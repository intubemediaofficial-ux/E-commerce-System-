# E-commerce Product Register

A deliberately simple, multi-tenant product register for a purchasing / product-listing team.

- `apps/api` — Express + TypeScript REST API, Prisma/PostgreSQL, Swagger docs
- `apps/web` — Next.js 14 App Router frontend (TanStack Query, Tailwind), fully responsive

## What a product is

Six fields, nothing else:

| Field | Notes |
| --- | --- |
| Product image | uploaded through `POST /api/uploads/images` |
| Product title | required |
| Cost price (₹) | purchase price |
| Warehouse / shop name | one plain text field |
| Date | defaults to today, editable |
| Inventory / current stock | the units physically in stock right now, edited manually |

There is no stock ledger, movement, transfer, adjustment workflow, batch, expiry, reservation,
reorder level, purchase order, supplier, warehouse module, order, customer, category, brand, unit
or report. The panel has three menu entries: Dashboard, Products, Add Product.

## Quick start (local)

```bash
cp .env.example .env                # then edit secrets
docker run -d --name ims-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ims -p 5432:5432 postgres:16-alpine

npm install
npm run db:migrate --workspace=api
npm run db:seed --workspace=api

npm run dev                         # api on :4000, web on :3000
```

Seed logins (development data only):

| Role | Email | Password |
| --- | --- | --- |
| Super admin | superadmin@demo.test | Admin@12345 |
| Admin (full access) | admin@demo.test | Admin@12345 |

## Verification

```bash
npm run lint
npm run typecheck
npm test          # unit + integration (needs Postgres and a seeded database)
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

Compose starts PostgreSQL, the API (runs `prisma migrate deploy` on boot) and the frontend.

## API

| Area | Endpoints |
| --- | --- |
| Auth | login/refresh/logout, refresh-token rotation, forgot/reset/change password, Argon2 hashing |
| RBAC | permission catalog, system + custom roles, Admin/Super Admin full bypass |
| Products | list/search, create, read, update, delete |
| Uploads | product image upload |
| Dashboard | total products, total current stock units, total purchase value, recently added |
| Admin | users, roles, organization profile, audit log |

The database still carries the tables from the earlier inventory build; they are unused by the
panel and are kept so existing rows are not destroyed.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment variables, migrations, backups,
monitoring and logging guidance.
