## Orders API – Short Overview

This is a small NestJS Orders service that implements the four main things the assessment asks for:

- **Idempotent create** using Redis + `Idempotency-Key`
- **Optimistic locking** on confirm using `If-Match`
- **Transactional outbox** row when an order is closed
- **Keyset pagination** for listing orders

Multi‑tenancy is done via `X-Tenant-Id` and each request gets a correlation ID (`X-Request-ID`). Events are “published” by logging an envelope instead of sending to Pulsar.

---

## How to run it

From the project root:

```bash
# 1) Start Postgres + Redis
docker-compose up -d

# 2) Apply schema
export PGPASSWORD=orders
psql -h localhost -p 5432 -U orders -d orders -f migrations/bootstrap.sql

# 3) Install deps and start Nest
pnpm install
pnpm start:dev
```

The HTTP API will be on `http://localhost:3000/api/v1` and Swagger on `http://localhost:3000/api`.

Every request to the orders endpoints must include:

- `X-Tenant-Id: <tenant>`  
- Optional: `X-Request-ID: <uuid>` (if you don’t send it, the app generates one and echoes it back).

---

## What’s implemented

- **Create order** (`POST /api/v1/orders`)
  - Creates a `draft` order, version `1`, scoped to the current tenant.
  - Idempotent via `Idempotency-Key` header and Redis (see below).
- **Confirm order** (`PATCH /api/v1/orders/:id/confirm`)
  - Requires `If-Match: "<version>"`.
  - Checks tenant + version and only allows `draft → confirmed`.
- **Close order** (`POST /api/v1/orders/:id/close`)
  - Only from `confirmed` status.
  - Runs in a transaction: updates the order to `closed` and writes one row in `outbox`.
- **List orders** (`GET /api/v1/orders?limit=&cursor=`)
  - Keyset pagination on `(created_at DESC, id DESC)` with an opaque base64 `cursor`.
- **Health**
  - `/health/liveness` and `/health/readiness` check DB + Redis.

Errors use a consistent JSON shape with `code`, `message`, `timestamp`, `path`, and optional `details`.

---

## Idempotency – what and why

**What is idempotency here?**  
If you send the **same** `POST /orders` request more than once with the **same** `Idempotency-Key` and body in a short period, the system should behave **as if it only happened once**. You get back the same order `id` and the same JSON instead of creating multiple draft orders.

**Why do we want it?**  
Clients (mobile apps, frontends, gateways) will often retry on timeouts or network errors. Without idempotency they might accidentally create 2–3 identical orders. Idempotency lets the server turn “flaky network spam” into “one clean action”.

**How it’s implemented here (high level):**

- When the app starts, `OrdersModule` builds a tiny “idempotency store” on top of Redis.
- For each `POST /orders` call:
  - It computes a simple hash of the request body (just `JSON.stringify`).
  - It looks up `idemp:<tenantId>:<Idempotency-Key>` in Redis.
    - If found:
      - If the stored `bodyHash` matches → return the stored response (replay).
      - If different → return `409` (`IDEMPOTENCY_KEY_CONFLICT`).
    - If not found:
      - Create the new draft order.
      - Build the response DTO.
      - Store `{ bodyHash, response }` in Redis with a 1‑hour TTL.

That’s enough for typical “retry the same request within a short window” scenarios without needing an extra SQL table.

---

## Very quick code map

- `src/main.ts` – creates the Nest app, sets `/api/v1` prefix, global validation, correlation‑ID interceptor, and Swagger.
- `src/app.module.ts` – wires config, TypeORM (Postgres), Redis, events, tenant module, orders module, and health module.
- `src/modules/orders/order.entity.ts` – TypeORM entity for the `orders` table (UUID `id`, `tenantId`, `status`, `version`, `totalCents`, timestamps, and an index for pagination).
- `src/modules/orders/outbox.entity.ts` – TypeORM entity for `outbox` table (one row per “order closed” event).
- `src/modules/orders/orders.service.ts` – core business logic:
  - `createDraft` (idempotent create + `orders.created` event),
  - `confirmOrder` (optimistic lock + `orders.confirmed` event),
  - `closeOrder` (transaction with outbox + `orders.closed` event),
  - `listOrders` (keyset pagination).
- `src/modules/orders/orders.controller.ts` – HTTP routes, reads headers (`Idempotency-Key`, `If-Match`, `X-Request-ID`) and passes them to the service.
- `src/tenant/*` – guard that enforces `X-Tenant-Id` and decorator to inject the tenant into controllers.
- `src/events/*` – envelope type and `EventsPublisher` which just logs events for now.
- `src/common/errors/error-response.ts` – small helper to return errors in one consistent JSON shape.

If you open those files in your editor from top to bottom and keep this summary next to you, you should be able to follow what each class and function does line by line.

