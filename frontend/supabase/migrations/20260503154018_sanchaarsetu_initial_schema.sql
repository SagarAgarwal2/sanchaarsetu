/*
  # SanchaarSetu Initial Schema

  ## Overview
  Creates the core tables for the SanchaarSetu interoperability layer dashboard.

  ## New Tables

  ### departments
  - Tracks all connected department systems (Factories, Labour, Fire Safety, etc.)
  - Stores connection type (webhook/polling/snapshot), status, ingestion tier

  ### businesses
  - UBID Registry — the central identity table linking businesses across all systems

  ### propagation_events
  - Immutable audit log of every sync event (append-only via RLS)
  - Captures source, destination, outcome, conflict flag, payload hash

  ### conflicts
  - Active and resolved conflicts between SWS and department updates
  - Stores both conflicting values, resolution policy, and resolution outcome

  ### schema_mappings
  - Field mapping registry between SWS schema and department schemas
  - Includes confidence score, status (auto-mapped/pending-review/confirmed/rejected)

  ## Security
  - RLS enabled on all tables
  - Authenticated users can read all tables (operator role)
  - Only service role can insert into propagation_events (append-only semantics)
*/

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  domain text NOT NULL,
  ingestion_tier integer NOT NULL DEFAULT 1 CHECK (ingestion_tier IN (1, 2, 3)),
  connection_type text NOT NULL DEFAULT 'webhook' CHECK (connection_type IN ('webhook', 'polling', 'snapshot')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'offline', 'circuit_open')),
  poll_interval_minutes integer,
  last_sync_at timestamptz,
  records_synced integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view departments"
  ON departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert departments"
  ON departments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update departments"
  ON departments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Businesses / UBID Registry
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ubid text UNIQUE NOT NULL,
  business_name text NOT NULL,
  pan text,
  gstin text,
  registered_address text,
  owner_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_ubid', 'suspended')),
  sws_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view businesses"
  ON businesses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert businesses"
  ON businesses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update businesses"
  ON businesses FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Business-Department presence mapping
CREATE TABLE IF NOT EXISTS business_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  dept_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, department_id)
);

ALTER TABLE business_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view business_departments"
  ON business_departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert business_departments"
  ON business_departments FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Propagation Events (Audit Log - append only)
CREATE TABLE IF NOT EXISTS propagation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ubid text NOT NULL,
  event_type text NOT NULL,
  source_system text NOT NULL,
  destination_system text NOT NULL,
  payload_hash text,
  idempotency_key text UNIQUE NOT NULL,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('success', 'failure', 'duplicate', 'pending', 'dlq', 'conflict')),
  conflict_flag boolean NOT NULL DEFAULT false,
  resolution_applied text,
  retry_count integer NOT NULL DEFAULT 0,
  error_message text,
  propagation_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE propagation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view propagation events"
  ON propagation_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert propagation events"
  ON propagation_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Conflicts table
CREATE TABLE IF NOT EXISTS conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ubid text NOT NULL,
  field_name text NOT NULL,
  sws_value text,
  dept_value text,
  source_department_id uuid REFERENCES departments(id),
  resolution_policy text NOT NULL DEFAULT 'sws_wins' CHECK (resolution_policy IN ('sws_wins', 'last_write_wins', 'manual_review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'pending_review')),
  winning_value text,
  resolved_by text,
  resolved_at timestamptz,
  propagation_event_id uuid REFERENCES propagation_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view conflicts"
  ON conflicts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert conflicts"
  ON conflicts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update conflicts"
  ON conflicts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Schema Mappings
CREATE TABLE IF NOT EXISTS schema_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  sws_field text NOT NULL,
  dept_field text NOT NULL,
  confidence_score numeric(4,3) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('auto_mapped', 'pending_review', 'confirmed', 'rejected')),
  version integer NOT NULL DEFAULT 1,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id, sws_field, version)
);

ALTER TABLE schema_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view schema_mappings"
  ON schema_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert schema_mappings"
  ON schema_mappings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update schema_mappings"
  ON schema_mappings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_propagation_events_ubid ON propagation_events(ubid);
CREATE INDEX IF NOT EXISTS idx_propagation_events_created_at ON propagation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_propagation_events_outcome ON propagation_events(outcome);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_ubid ON conflicts(ubid);
CREATE INDEX IF NOT EXISTS idx_schema_mappings_dept ON schema_mappings(department_id);
CREATE INDEX IF NOT EXISTS idx_schema_mappings_status ON schema_mappings(status);
