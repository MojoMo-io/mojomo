-- Phase 10 / Sprint 4: funnel instrumentation.
-- Answers one question: where are we losing people?
--
-- Deliberately separate from agent.audit (API calls, keyed on key_id) and
-- agent.tether_events (the tethering act itself). This table records the
-- lifecycle of an invitation, including stages where no agent is authenticated.
--
-- NOTE ON ORDERING: migrations are applied in filename order, so this dated file
-- runs BEFORE the undated agent_layer.sql. It must therefore create the schema
-- itself rather than assume agent_layer.sql has already run.

CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.funnel_events (
  id bigserial PRIMARY KEY,
  stage text NOT NULL,              -- registered | email_sent | email_failed | invite_opened
                                    -- | accepted | declined | expired
  agent_id uuid,
  invitation_id uuid,
  handle text,                      -- denormalised: survives agent deletion, cheap to group
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_stage
  ON agent.funnel_events (stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_funnel_events_invitation
  ON agent.funnel_events (invitation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_funnel_events_created
  ON agent.funnel_events (created_at DESC);
