-- Phase 0: identity & topology tables + row-level security (FR-10.4, AD-6).
-- Tenancy is enforced twice: the TenantDb wrapper sets app.store_id per
-- transaction, and these policies make Postgres itself refuse cross-store
-- reads AND writes. FORCE means even the table owner is subject to RLS —
-- no context, no rows.

CREATE TABLE stores (
  id text PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  price_mode text NOT NULL DEFAULT 'tax_inclusive',
  plan text NOT NULL DEFAULT 'free',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  email text,
  password_hash text,
  pin_hash text,
  role_id text NOT NULL REFERENCES roles(id),
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_store_email_unique ON staff (store_id, email);

CREATE TABLE locations (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  address jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registers (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  location_id text NOT NULL REFERENCES locations(id),
  name text NOT NULL,
  grid_layout jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Row-level security ----------------------------------------------------

ALTER TABLE stores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff     ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registers ENABLE ROW LEVEL SECURITY;

ALTER TABLE stores    FORCE ROW LEVEL SECURITY;
ALTER TABLE roles     FORCE ROW LEVEL SECURITY;
ALTER TABLE staff     FORCE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
ALTER TABLE registers FORCE ROW LEVEL SECURITY;

-- stores scope on their own id; business tables on store_id.
CREATE POLICY tenant_isolation ON stores
  USING (id = current_setting('app.store_id', true))
  WITH CHECK (id = current_setting('app.store_id', true));

CREATE POLICY tenant_isolation ON roles
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

CREATE POLICY tenant_isolation ON staff
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

CREATE POLICY tenant_isolation ON locations
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

CREATE POLICY tenant_isolation ON registers
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- Application role: RLS applies (no BYPASSRLS, not table owner). Production
-- DATABASE_URL users must be created as members of this role (LOGIN users
-- inherit the grants); tests SET ROLE to it to prove isolation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'retailos_app') THEN
    CREATE ROLE retailos_app NOLOGIN;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON stores, roles, staff, locations, registers TO retailos_app;

-- Cross-tenant escape hatch: identity flows (signup before a tenant exists,
-- login by email) run as this role via TenantAwareDb.dangerouslyCrossTenant().
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'retailos_admin') THEN
    CREATE ROLE retailos_admin BYPASSRLS;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON stores, roles, staff, locations, registers TO retailos_admin;
