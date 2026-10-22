-- Privacy (item 40): explicit consent before recording, and deletion requests awaiting confirmation.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
