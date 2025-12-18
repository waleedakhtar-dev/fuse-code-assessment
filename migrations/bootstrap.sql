-- orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  status text NOT NULL,
  version int NOT NULL,
  total_cents int NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created_id
  ON orders (tenant_id, created_at DESC, id DESC);

-- outbox table
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  order_id uuid NOT NULL,
  tenant_id text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_event_type ON outbox (event_type);
CREATE INDEX IF NOT EXISTS idx_outbox_order_id ON outbox (order_id);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant ON outbox (tenant_id);


