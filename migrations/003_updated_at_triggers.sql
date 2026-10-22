-- Keep updated_at correct on every real change (item 28).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- WHEN skips no-op updates (e.g. the vendor upsert that runs on every message).
CREATE OR REPLACE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
  