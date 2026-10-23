-- Vendor catalog and customer orders (WhatsApp "duka 4821" and web /k/4821).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS shop_code TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS catalog_items (
  id         BIGSERIAL PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES vendors(id),
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,                 -- lower(name)
  price      NUMERIC NOT NULL CHECK (price > 0),
  available  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, name_key)
);

CREATE TABLE IF NOT EXISTS orders (
  id                 BIGSERIAL PRIMARY KEY,
  vendor_id          BIGINT NOT NULL REFERENCES vendors(id),
  number             INT NOT NULL,          -- per vendor: #1, #2 ...
  customer_phone     TEXT NOT NULL,         -- 255XXXXXXXXX
  customer_name      TEXT,
  customer_lang      TEXT NOT NULL DEFAULT 'sw',
  delivery           TEXT,                  -- NULL = customer collects
  channel            TEXT NOT NULL CHECK (channel IN ('whatsapp', 'web')),
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected', 'done')),
  total              NUMERIC NOT NULL,
  vendor_notified_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, number)
);
CREATE INDEX IF NOT EXISTS orders_vendor_status_idx ON orders (vendor_id, status);

CREATE TABLE IF NOT EXISTS order_items (
  id       BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id  BIGINT,                          -- catalog item at the time (may be removed later)
  name     TEXT NOT NULL,
  price    NUMERIC NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- A customer's open shop visit on WhatsApp: which shop, cart, and whether we are asking for delivery details.
CREATE TABLE IF NOT EXISTS customer_sessions (
  phone      TEXT PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES vendors(id),
  lang       TEXT NOT NULL DEFAULT 'sw',
  cart       JSONB NOT NULL DEFAULT '[]',
  step       TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_log_phone_idx ON messages_log (phone_number, created_at);
