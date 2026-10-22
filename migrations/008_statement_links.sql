-- Business statement links (shareable with lenders): only the token hash is stored.
CREATE TABLE IF NOT EXISTS statement_links (
  token_hash TEXT PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES vendors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS statement_links_vendor_idx ON statement_links (vendor_id);
