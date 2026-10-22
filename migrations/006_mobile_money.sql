-- Mobile-money SMS import (item 38): the provider's transaction ID, so the same SMS can't be recorded twice.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_vendor_external_ref_uniq
  ON transactions (vendor_id, external_ref) WHERE external_ref IS NOT NULL AND deleted_at IS NULL;
  