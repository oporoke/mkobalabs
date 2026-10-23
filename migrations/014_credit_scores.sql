-- Mkoba credit score: one snapshot per vendor per day (when the vendor asks, or a statement is opened).
CREATE TABLE IF NOT EXISTS credit_scores (
  vendor_id  BIGINT NOT NULL REFERENCES vendors(id),
  day        DATE NOT NULL,
  score      INT NOT NULL,
  parts      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, day)
);
