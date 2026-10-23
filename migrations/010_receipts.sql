-- Digital receipts and loyalty points. Points are computed from the live sale records of each receipt's message.
CREATE TABLE IF NOT EXISTS receipts (
  id             BIGSERIAL PRIMARY KEY,
  vendor_id      BIGINT NOT NULL REFERENCES vendors(id),
  number         INT NOT NULL,            -- per vendor: R-0001, R-0002 ...
  customer_phone TEXT NOT NULL,           -- 255XXXXXXXXX
  message_id     BIGINT,                  -- the vendor's message; its sale transactions share this message_id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, number)
);
CREATE INDEX IF NOT EXISTS receipts_vendor_customer_idx ON receipts (vendor_id, customer_phone);

CREATE TABLE IF NOT EXISTS point_redemptions (
  id             BIGSERIAL PRIMARY KEY,
  vendor_id      BIGINT NOT NULL REFERENCES vendors(id),
  customer_phone TEXT NOT NULL,
  points         INT NOT NULL CHECK (points > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_redemptions_vendor_customer_idx ON point_redemptions (vendor_id, customer_phone);
