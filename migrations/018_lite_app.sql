-- Lite App: records sent from the phone app carry a client id, so a retry after a lost connection never saves twice.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_client_ref_idx ON transactions (vendor_id, client_ref) WHERE client_ref IS NOT NULL;
