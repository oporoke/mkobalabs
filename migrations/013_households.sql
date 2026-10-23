-- Household group buys: households are stored as vendors with kind = 'household' (same groups and bulk orders),
-- and every member can say where they receive bulk goods: the group point (default), home, or a named place.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'vendor';
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_kind_check CHECK (kind IN ('vendor', 'household'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_delivery_mode_check CHECK (delivery_mode IN ('point', 'home', 'place'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS delivery_address TEXT;
