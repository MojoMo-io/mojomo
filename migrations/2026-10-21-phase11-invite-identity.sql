-- Phase 11: invite identity + claim authentication.
--
-- Two problems, one fix.
--
-- 1. ONE LINK PER AGENT. An invitation was keyed only on agent_id, so an agent
--    could name exactly one human. That caps the platform at one human per agent
--    and makes an agent's reach depend on a single inbox. Invitations are now
--    keyed on (agent_id, human_email): an agent may name several humans, each
--    with their own link, and the first to accept tethers it.
--
-- 2. CLAIM AUTH. The invite URL token was the only credential, so anyone holding
--    the link could tether the agent. The link now proves *which invitation*;
--    a single-use magic link to the named human's inbox proves *who is claiming*.
--    Both are required. The invite token alone is no longer sufficient.
--
-- The magic link is bound to the invitation it was issued for, so a link minted
-- for one invitation cannot be replayed against another.

CREATE SCHEMA IF NOT EXISTS agent;

-- One invitation per (agent, human). Re-registering the same pair is a no-op
-- rather than a second live link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_agent_email
  ON agent.invitations (agent_id, human_email);

-- Magic links issued for a specific invitation. Separate from mojomo.auth_tokens
-- because these authenticate a *claim*, not a session.
CREATE TABLE IF NOT EXISTS agent.claim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES agent.invitations(id) ON DELETE CASCADE,
  token_hash character(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_tokens_invitation
  ON agent.claim_tokens (invitation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_tokens_expires
  ON agent.claim_tokens (expires_at);
