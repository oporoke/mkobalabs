-- Jirani Bulk Buy: collection points (groups), wholesale products, weekly group orders, and notices kept for later delivery.
CREATE TABLE IF NOT EXISTS collection_points (
  id         BIGSERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,          -- e.g. SIN01
  name       TEXT NOT NULL,
  area       TEXT,
  lat        NUMERIC,
  lng        NUMERIC,
  created_by BIGINT REFERENCES vendors(id), -- NULL = added by the admin
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES collection_points(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng NUMERIC;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bulk_hint_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bulk_products (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,                 -- lower(name), as vendors write it
  unit       TEXT NOT NULL DEFAULT '',      -- kg, l, g, or '' for pieces
  price      NUMERIC NOT NULL CHECK (price > 0),
  active     BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name_key, unit)
);

CREATE TABLE IF NOT EXISTS bulk_orders (
  id         BIGSERIAL PRIMARY KEY,
  point_id   BIGINT NOT NULL REFERENCES collection_points(id),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at  TIMESTAMPTZ NOT NULL,
  closed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bulk_orders_one_open_idx ON bulk_orders (point_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS bulk_lines (
  id            BIGSERIAL PRIMARY KEY,
  bulk_order_id BIGINT NOT NULL REFERENCES bulk_orders(id),
  vendor_id     BIGINT NOT NULL REFERENCES vendors(id),
  item_key      TEXT NOT NULL,
  item          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  price         NUMERIC,                    -- wholesale price per unit, fixed when the order closes
  received_at   TIMESTAMPTZ,
  UNIQUE (bulk_order_id, vendor_id, item_key, unit)
);

CREATE TABLE IF NOT EXISTS vendor_notices (
  id           BIGSERIAL PRIMARY KEY,
  vendor_id    BIGINT NOT NULL REFERENCES vendors(id),
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS vendor_notices_waiting_idx ON vendor_notices (vendor_id) WHERE delivered_at IS NULL;
