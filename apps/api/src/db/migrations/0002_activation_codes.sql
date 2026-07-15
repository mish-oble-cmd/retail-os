-- Phase 1 / 1A (ADM-16): register activation codes.
-- Policy (decided 2026-07-10, offline-sync-strategy.md): 8-char Crockford
-- base32, single-use, 24 h expiry, revocable. Only a sha-256 hash is stored;
-- the plain code is shown once at generation. Server-only table — no sync_rev.

ALTER TABLE registers ADD CONSTRAINT registers_store_id_unique UNIQUE (store_id, id);

CREATE TABLE activation_codes (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activation_codes_register_fk FOREIGN KEY (store_id, register_id)
    REFERENCES registers (store_id, id),
  CONSTRAINT activation_codes_staff_fk FOREIGN KEY (store_id, created_by)
    REFERENCES staff (store_id, id)
);
CREATE UNIQUE INDEX activation_codes_store_hash_unique ON activation_codes (store_id, code_hash);
CREATE INDEX activation_codes_store_register_idx ON activation_codes (store_id, register_id);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activation_codes
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- Revocation and consumption are UPDATEs; codes are never deleted (audit trail).
GRANT SELECT, INSERT, UPDATE ON activation_codes TO retailos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON activation_codes TO retailos_admin;
