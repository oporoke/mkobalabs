-- Mobile-money payments through Selcom, and payouts recorded by the admin.
CREATE TABLE IF NOT EXISTS payments (
  id              BIGSERIAL PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE,         -- our order_id at Selcom, e.g. MKBLQ3X9A1F2
  purpose         TEXT NOT NULL CHECK (purpose IN ('order', 'bulk', 'delivery')),
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  payer_phone     TEXT NOT NULL,
  payer_name      TEXT,
  lang            TEXT NOT NULL DEFAULT 'sw',
  order_id        BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  bulk_order_id   BIGINT REFERENCES bulk_orders(id),
  member_id       BIGINT REFERENCES vendors(id) ON DELETE SET NULL,
  delivery_id     BIGINT REFERENCES deliveries(id) ON DELETE SET NULL,
  vendor_id       BIGINT REFERENCES vendors(id) ON DELETE SET NULL,  -- shop owed the order amount
  vendor_amount   NUMERIC NOT NULL DEFAULT 0,
  rider_amount    NUMERIC NOT NULL DEFAULT 0,
  supplier_amount NUMERIC NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  gateway_url     TEXT,
  selcom_transid  TEXT,
  reference       TEXT,
  channel         TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_payer_idx ON payments (payer_phone, status);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

CREATE TABLE IF NOT EXISTS payouts (
  id         BIGSERIAL PRIMARY KEY,
  payee_type TEXT NOT NULL CHECK (payee_type IN ('vendor', 'rider')),
  payee_id   BIGINT NOT NULL,
  amount     NUMERIC NOT NULL CHECK (amount > 0),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
