## Orders API (NestJS Assessment)

Minimal Orders service built with **NestJS**, **TypeORM**, **PostgreSQL**, and **Redis**, implementing:

- **Idempotent create** via `Idempotency-Key` stored in Redis (TTL 1 hour)
- **Optimistic locking** on confirm via `If-Match` version
- **Transactional outbox** row on close
- **Keyset pagination** for listing orders
- **Multi-tenancy** via `X-Tenant-Id`
- **Correlation ID** via `X-Request-ID`

This is geared for the assessment; Apache Pulsar is **mocked** via a simple event publisher that logs CloudEvent-like envelopes.

---

## Stack & Choices

- **NestJS** (HTTP app, controllers/modules, Swagger at `/api`)
- **TypeORM** with **PostgreSQL**
- **Redis** (via `ioredis`) for **idempotency keys** – TTL 1h
- **Tenant scoping**: `X-Tenant-Id` header (chosen over JWT for simplicity)
- **Correlation ID**: `X-Request-ID` header (generated if missing, returned on all responses)
- **Event publishing**: `EventsPublisher` service that logs an envelope shaped like:

```json
{
  "id": "uuid",
  "type": "orders.created",
  "source": "orders-service",
  "tenantId": "tenant-1",
  "time": "2025-01-26T10:30:00Z",
  "schemaVersion": "1",
  "traceId": "optional-correlation-id",
  "data": { "...": "..." }
}
```

---

## Project Structure

- `src/app.module.ts` – root Nest module (config, DB, Redis, events, orders, health)
- `src/main.ts` – bootstrap, global validation, correlation ID interceptor, Swagger
- `src/config/*` – app, database, and Redis configuration
- `src/common/` – error helpers, interceptors (correlation ID)
- `src/tenant/` – `TenantGuard` (reads `X-Tenant-Id`), `@Tenant()` decorator
- `src/events/` – event envelope type and `EventsPublisher` (mock Pulsar)
- `src/modules/health/` – `/health/liveness`, `/health/readiness`
- `src/modules/orders/`
  - `order.entity.ts` – `orders` table (UUID id, tenant_id, status, version, total_cents, timestamps)
  - `outbox.entity.ts` – `outbox` table for transactional outbox rows
  - `dto/` – create/confirm/list DTOs
  - `orders.service.ts` – domain logic (create/confirm/close/list)
  - `orders.controller.ts` – HTTP endpoints under `/api/v1/orders`
  - `orders.module.ts` – wires Redis idempotency store and events publisher

Database schema is bootstrapped by `migrations/bootstrap.sql`.

---

## Running Locally

### 1. Requirements

- Node.js 18+
- `pnpm` (as package manager)
- Docker + docker-compose

### 2. Start Postgres & Redis

From the project root:

```bash
docker-compose up -d
```

This starts:

- **Postgres** on `localhost:5432` with `orders` / `orders` / `orders`
- **Redis** on `localhost:6379`

### 3. Run DB bootstrap SQL

Apply the schema to Postgres (requires `psql` in PATH):

```bash
export PGPASSWORD=orders
psql -h localhost -p 5432 -U orders -d orders -f migrations/bootstrap.sql
```

### 4. Install dependencies

```bash
pnpm install
```

### 5. Start the app

```bash
pnpm start:dev
```

The API listens on **`http://localhost:3000`** with base path **`/api/v1`**.

Swagger UI is available at **`http://localhost:3000/api`**.

---

## Configuration

Environment variables (with defaults):

- `PORT` – default `3000`
- `DB_HOST` – default `localhost`
- `DB_PORT` – default `5432`
- `DB_USER` – default `orders`
- `DB_PASSWORD` – default `orders`
- `DB_NAME` – default `orders`
- `REDIS_HOST` – default `localhost`
- `REDIS_PORT` – default `6379`

These are read via `@nestjs/config` in `app.module.ts` and `redis.module.ts`.

---

## Endpoints & Behaviour

All order endpoints require:

- **Tenant**: `X-Tenant-Id: <tenant>` (scopes all queries)
- **Correlation ID (optional)**: `X-Request-ID: <uuid>`  
  - If omitted, a correlation ID is generated and returned as `X-Request-ID`.

### Health

- `GET /health/liveness`  
  Response: `{ "status": "ok" }`

- `GET /health/readiness`  
  Response:

```json
{
  "status": "ready" | "not_ready",
  "checks": {
    "database": "up" | "down",
    "redis": "up" | "down"
  }
}
```

### POST /api/v1/orders — create draft (idempotent)

Headers:

- `X-Tenant-Id: <tenant>` (required)
- `Idempotency-Key: <string>` (required)
- `X-Request-ID: <uuid>` (optional)

Body:

```json
{}
```

Behaviour:

- Creates a **draft** order for the tenant on first call:
  - `status = "draft"`, `version = 1`, `totalCents = null`.
- Persists **idempotency key** in Redis with TTL 1 hour:
  - Key: `idemp:<tenant>:<Idempotency-Key>`
  - Value: `{ bodyHash, response }` (JSON)
- **Same key + same body** within 1 hour → returns the original response (replay).
- **Same key + different body** → `409` with error format described below.
- Publishes an `orders.created` event via `EventsPublisher` (logs envelope).

Response example:

```json
{
  "id": "uuid",
  "tenantId": "tenant-1",
  "status": "draft",
  "version": 1,
  "createdAt": "2025-01-26T10:30:00Z"
}
```

### PATCH /api/v1/orders/:id/confirm — optimistic locking

Headers:

- `X-Tenant-Id: <tenant>`
- `If-Match: "<version>"` (required; e.g. `"1"`)
- `X-Request-ID: <uuid>` (optional)

Body:

```json
{ "totalCents": 1234 }
```

Behaviour:

- Allowed transition: **draft → confirmed**.
- Looks up order by `id` **and** `tenantId`.
- Verifies `order.version === If-Match`:
  - On mismatch → `409` with `ORDER_VERSION_CONFLICT`.
- On non-draft status → `400` with `ORDER_STATUS_INVALID`.
- On success:
  - `status = "confirmed"`
  - `totalCents` set
  - `version` increments
- Publishes `orders.confirmed` event.

Response example:

```json
{
  "id": "uuid",
  "status": "confirmed",
  "version": 2,
  "totalCents": 1234
}
```

### POST /api/v1/orders/:id/close — transactional outbox

Headers:

- `X-Tenant-Id: <tenant>`
- `X-Request-ID: <uuid>` (optional)

Behaviour (single DB transaction):

1. Locks order row (`pessimistic_write`), filtered by `id` and `tenantId`.
2. Preconditions: `status === "confirmed"`; otherwise `400` with `ORDER_STATUS_INVALID`.
3. Updates order:
   - `status = "closed"`
   - `version` increments
4. Inserts **one outbox row** into `outbox`:
   - `event_type = "orders.closed"`
   - `payload = { orderId, tenantId, totalCents, closedAt }`
5. Publishes `orders.closed` event via `EventsPublisher`.

Response example:

```json
{
  "id": "uuid",
  "status": "closed",
  "version": 3
}
```

### GET /api/v1/orders?limit=10&cursor=<opaque> — keyset pagination

Headers:

- `X-Tenant-Id: <tenant>`
- `X-Request-ID: <uuid>` (optional)

Query:

- `limit` – default `20`, max `100`
- `cursor` – opaque base64-encoded JSON that encodes `{ createdAt, id }`

Ordering:

- `ORDER BY created_at DESC, id DESC`

Behaviour:

- Filters by `tenantId` (multi-tenancy).
- Fetches `limit + 1` rows to detect if there is a **next** page.
- Cursor logic:
  - For subsequent pages, adds:
    - `created_at < last.created_at` OR
    - `created_at = last.created_at AND id < last.id`
  - Ensures **stable pagination** with no duplicates or skips.

Response example:

```json
{
  "items": [
    {
      "id": "uuid",
      "tenantId": "tenant-1",
      "status": "draft",
      "version": 1,
      "totalCents": null,
      "createdAt": "2025-01-26T10:30:00Z"
    }
  ],
  "nextCursor": "base64-opaque-token-or-null"
}
```

---

## Error Shape

All non-2xx responses use a unified error format:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order with ID 123 not found",
    "timestamp": "2025-01-26T10:30:00Z",
    "path": "/api/v1/orders/123",
    "details": {
      "orderId": "123"
    }
  }
}
```

Examples:

- `IDEMPOTENCY_KEY_CONFLICT` – same idempotency key, different request body.
- `ORDER_NOT_FOUND` – order not found for tenant.
- `ORDER_VERSION_CONFLICT` – stale `If-Match` header on confirm.
- `ORDER_STATUS_INVALID` – invalid status transition (e.g. confirm non-draft, close non-confirmed).

---

## Example cURL Sequence

Assume:

- `TENANT=tenant-1`
- `IDEMP_KEY=my-key-1`

### 1. Create draft (idempotent)

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT}" \
  -H "Idempotency-Key: ${IDEMP_KEY}" \
  -d '{}'
```

Repeat with the **same** body and `Idempotency-Key` within 1h → same response (idempotent).

### 2. Confirm with optimistic locking

Suppose the created order has:

- `id = ORDER_ID`
- `version = 1`

```bash
curl -X PATCH http://localhost:3000/api/v1/orders/${ORDER_ID}/confirm \
  -H 'Content-Type: application/json' \
  -H "X-Tenant-Id: ${TENANT}" \
  -H 'If-Match: "1"' \
  -d '{"totalCents": 1234}'
```

Using a stale version (e.g. `"0"` or `"1"` after a previous confirm) returns `409`.

### 3. Close order (transactional outbox)

```bash
curl -X POST http://localhost:3000/api/v1/orders/${ORDER_ID}/close \
  -H "X-Tenant-Id: ${TENANT}"
```

After this, the order is `closed` and the `outbox` table contains exactly one row with `event_type = 'orders.closed'` for that order.

### 4. List orders with pagination

First page:

```bash
curl "http://localhost:3000/api/v1/orders?limit=10" \
  -H "X-Tenant-Id: ${TENANT}"
```

Then, if `nextCursor` is non-null:

```bash
curl "http://localhost:3000/api/v1/orders?limit=10&cursor=${NEXT_CURSOR}" \
  -H "X-Tenant-Id: ${TENANT}"
```

---

## Testing Notes

- Jest + Supertest config is wired in `package.json`, but full integration tests are not yet implemented in this snapshot.  
- A typical approach (if you extend this) would be:
  - Use **Testcontainers** or docker-compose for Postgres + Redis in tests.
  - Spin up the Nest app with `AppModule` and run HTTP tests using Supertest.
  - Cover:
    - Idempotency edge cases
    - Optimistic locking success + conflict
    - Close + outbox row creation in a transaction
    - Stable keyset pagination (no duplicates, correct page sizes)


