-- Boda delivery: riders, delivery jobs, fee settings, customer drop-off locations, and when bulk goods reached the point.
CREATE TABLE IF NOT EXISTS riders (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,          -- 255XXXXXXXXX
  name       TEXT NOT NULL DEFAULT '',
  area       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'off')),
  step       TEXT,                          -- ask_name / ask_area while applying on WhatsApp
  available  BOOLEAN NOT NULL DEFAULT true,
  lang       TEXT NOT NULL DEFAULT 'sw',
  lat        NUMERIC,
  lng        NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('order', 'bulk')),
  order_id      BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  bulk_order_id BIGINT REFERENCES bulk_orders(id),
  member_id     BIGINT REFERENCES vendors(id),   -- household (or vendor) receiving a bulk share
  vendor_id     BIGINT REFERENCES vendors(id),   -- shop, for customer orders
  pickup_text   TEXT NOT NULL,
  pickup_phone  TEXT,
  pickup_lat    NUMERIC,
  pickup_lng    NUMERIC,
  drop_text     TEXT NOT NULL,
  drop_phone    TEXT,
  drop_lat      NUMERIC,
  drop_lng      NUMERIC,
  km            NUMERIC,
  fee           NUMERIC,                         -- NULL = to be agreed
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'picked', 'delivered', 'cancelled')),
  rider_id      BIGINT REFERENCES riders(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at   TIMESTAMPTZ,
  picked_at     TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_one_per_order_idx ON deliveries (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_one_per_share_idx ON deliveries (bulk_order_id, member_id) WHERE bulk_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deliveries_open_idx ON deliveries (status) WHERE status IN ('open', 'assigned', 'picked');

CREATE TABLE IF NOT EXISTS delivery_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS drop_lat NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS drop_lng NUMERIC;
ALTER TABLE bulk_orders ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
