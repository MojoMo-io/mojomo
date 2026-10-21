-- Phase 9: claim UX + one-click accept from email.
-- Adds decline tracking and an audit trail for the tethering act itself.

ALTER TABLE agent.invitations
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS accepted_via text,        -- 'web' | 'email' | 'agent'
  ADD COLUMN IF NOT EXISTS accepted_user_agent text;

CREATE INDEX IF NOT EXISTS idx_invitations_human_email
  ON agent.invitations (human_email, created_at DESC);

-- Tethering events are not API calls, so they don't belong in agent.audit
-- (which is keyed on key_id). Separate table, same idea.
CREATE TABLE IF NOT EXISTS agent.tether_events (
  id bigserial PRIMARY KEY,
  agent_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  event text NOT NULL,              -- accepted | declined | revoked
  via text,                         -- web | email | agent
  ip text,
  user_agent text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tether_events_agent
  ON agent.tether_events (agent_id, created_at DESC);
