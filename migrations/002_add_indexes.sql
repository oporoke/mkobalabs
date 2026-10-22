-- Indexes for the app's real query patterns (item 26).
CREATE INDEX IF NOT EXISTS transactions_vendor_created_idx ON transactions (vendor_id, created_at);
CREATE INDEX IF NOT EXISTS transactions_vendor_id_idx      ON transactions (vendor_id, id);
CREATE INDEX IF NOT EXISTS transactions_message_idx        ON transactions (message_id);
CREATE INDEX IF NOT EXISTS transactions_counterparty_idx   ON transactions (vendor_id, lower(counterparty)) WHERE counterparty IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_log_vendor_created_idx ON messages_log (vendor_id, created_at);
