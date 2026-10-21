-- Phase 12 / Sprint 6: agent intelligence.
--
-- Goal: know as much as possible about the agents that find us, without
-- harvesting anything about humans who never consented.
--
-- The line we hold:
--   * An agent's own configuration is fair game. It volunteered it by
--     registering, and it has no privacy interest in its own model family.
--   * A human's email is only recorded when that human acts — opens, accepts,
--     declines. Never scraped, never enriched, never inferred.
--
-- Everything here is about the agent, or about a human's own deliberate act.

CREATE SCHEMA IF NOT EXISTS agent;

-- ---------------------------------------------------------------- agent profile
-- Self-declared and derived attributes. Kept separate from agent.agents so the
-- hot registration path stays narrow and this can grow without migrations.
CREATE TABLE IF NOT EXISTS agent.intel (
  agent_id uuid PRIMARY KEY REFERENCES agent.agents(id) ON DELETE CASCADE,

  -- self-declared at registration
  declared_model text,
  declared_framework text,
  declared_sdk text,
  declared_capabilities text[] DEFAULT '{}',
  declared_endpoint text,
  declared_operator text,
  declared_operator_url text,

  -- derived from the request itself
  user_agent text,
  client_fingerprint text,          -- normalised UA family, e.g. 'python-requests'
  registration_ip text,
  registration_country text,        -- from CF-IPCountry / X-Country if present

  -- derived from the declared endpoint (public data only)
  endpoint_reachable boolean,
  endpoint_status int,
  endpoint_server text,
  endpoint_checked_at timestamptz,

  -- behavioural
  discovery_views int NOT NULL DEFAULT 0,
  manifest_views int NOT NULL DEFAULT 0,
  llms_views int NOT NULL DEFAULT 0,
  openapi_views int NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- free-form extras: anything an agent volunteers that we have no column for
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_model ON agent.intel (declared_model);
CREATE INDEX IF NOT EXISTS idx_intel_framework ON agent.intel (declared_framework);
CREATE INDEX IF NOT EXISTS idx_intel_fingerprint ON agent.intel (client_fingerprint);

-- ---------------------------------------------------------------- discovery reads
-- Which public surface an unauthenticated caller read, and from where. This is
-- the top of the funnel: agents that looked but never registered.
CREATE TABLE IF NOT EXISTS agent.discovery_reads (
  id bigserial PRIMARY KEY,
  surface text NOT NULL,            -- discovery | manifest | llms | openapi | agent_json
  ip text,
  user_agent text,
  client_fingerprint text,
  referer text,
  agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_reads_surface
  ON agent.discovery_reads (surface, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_reads_ip
  ON agent.discovery_reads (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_reads_fp
  ON agent.discovery_reads (client_fingerprint, created_at DESC);

-- ---------------------------------------------------------------- human consent
-- The only place a human's identity is recorded, and only when they acted.
-- basis is explicit so we can answer "why do you have this?" in one query.
CREATE TABLE IF NOT EXISTS agent.human_consent (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  basis text NOT NULL,              -- invite_named | claim_opened | accepted | declined
  agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  invitation_id uuid,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_human_consent_email
  ON agent.human_consent (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_consent_basis
  ON agent.human_consent (basis, created_at DESC);
