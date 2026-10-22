-- Reply language per vendor (item 37): 'sw' (default) or 'en'.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'sw';
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_language_check CHECK (language IN ('sw', 'en'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
