-- Stock (stoo): the vendor's own counts and alert levels. Current stock = count + purchases - sales recorded after the count.
CREATE TABLE IF NOT EXISTS stock_items (
  vendor_id   BIGINT NOT NULL REFERENCES vendors(id),
  item_key    TEXT NOT NULL,              -- lower(item)
  unit        TEXT NOT NULL DEFAULT '',   -- kg, l, g, or '' for pieces
  item        TEXT NOT NULL,
  counted_qty NUMERIC,                    -- last count the vendor entered (NULL: not counted, only records)
  counted_at  TIMESTAMPTZ,
  alert_below NUMERIC,                    -- vendor's own alert level (NULL: automatic)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, item_key, unit)
);
-- Stock reads transactions by vendor and item
CREATE INDEX IF NOT EXISTS transactions_vendor_item_idx ON transactions (vendor_id, lower(item)) WHERE item IS NOT NULL;
