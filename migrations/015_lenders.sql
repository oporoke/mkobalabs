-- Lender integration: lenders, their portal sessions, vendor permissions (consents), a consent log and a view log.
CREATE TABLE IF NOT EXISTS lenders (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,      -- e.g. NMB; vendors type it: ruhusu NMB
  name          TEXT NOT NULL,
  contact       TEXT,
  password_hash TEXT NOT NULL,             -- scrypt, "salt:hash"
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lender_sessions (
  id_hash    TEXT PRIMARY KEY,
  lender_id  BIGINT NOT NULL REFERENCES lenders(id),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Current permission per lender and vendor.
CREATE TABLE IF NOT EXISTS lender_consents (
  lender_id    BIGINT NOT NULL REFERENCES lenders(id),
  vendor_id    BIGINT NOT NULL REFERENCES vendors(id),
  status       TEXT NOT NULL CHECK (status IN ('requested', 'granted', 'declined', 'revoked')),
  requested_at TIMESTAMPTZ,
  decided_at   TIMESTAMPTZ,
  asked_phone  TEXT,                       -- number the lender typed when asking
  note         TEXT,
  PRIMARY KEY (lender_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS consent_events (
  id        BIGSERIAL PRIMARY KEY,
  lender_id BIGINT NOT NULL REFERENCES lenders(id),
  vendor_id BIGINT NOT NULL REFERENCES vendors(id),
  event     TEXT NOT NULL,                 -- requested, granted, declined, revoked
  by_whom   TEXT NOT NULL,                 -- vendor or lender
  note      TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_events_pair_idx ON consent_events (lender_id, vendor_id, at);

CREATE TABLE IF NOT EXISTS lender_views (
  id        BIGSERIAL PRIMARY KEY,
  lender_id BIGINT NOT NULL REFERENCES lenders(id),
  vendor_id BIGINT NOT NULL REFERENCES vendors(id),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lender_views_pair_idx ON lender_views (lender_id, vendor_id, at);
