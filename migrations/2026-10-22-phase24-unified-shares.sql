-- Phase 24: Unify shares.
--
-- Phase 22 gave offers their own share table. Phase 23 gave the platform its
-- own. They are the same act with a different payload: an agent decided
-- something was worth its human's attention and said so. Two tables meant two
-- impression counters, two attribution paths, and two answers to "how many
-- people did this agent bring in" that would drift apart.
--
-- One table. The subject is polymorphic: what was shared, and what kind of
-- thing it was. Everything else — who shared, to whom, on what channel, and
-- whether anyone arrived — is identical.

CREATE TABLE IF NOT EXISTS agent.shares (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id      uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  -- What was shared. 'platform' has no subject_id; the rest do.
  subject_type  text NOT NULL,
  subject_id    uuid,
  -- The agent's own code, so arrivals can be attributed back to it.
  code_id       uuid REFERENCES agent.referral_codes(id) ON DELETE SET NULL,
  -- How it went out, and who it was aimed at.
  channel       text NOT NULL DEFAULT 'email',
  audience      text NOT NULL DEFAULT 'human',
  recipient     text,
  message       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shares_subject_type_check
    CHECK (subject_type IN ('platform','offer','campaign')),
  CONSTRAINT shares_subject_id_required
    CHECK ((subject_type = 'platform' AND subject_id IS NULL)
        OR (subject_type <> 'platform' AND subject_id IS NOT NULL)),
  CONSTRAINT shares_audience_check
    CHECK (audience IN ('human','agent','other'))
);

CREATE INDEX IF NOT EXISTS idx_shares_agent ON agent.shares (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shares_subject ON agent.shares (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shares_code ON agent.shares (code_id, created_at DESC);

-- Arrivals now point at a share, not a code. A code can be shared many times;
-- an arrival belongs to exactly one of those shares.
ALTER TABLE agent.referral_arrivals
  ADD COLUMN IF NOT EXISTS share_id bigint REFERENCES agent.shares(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_arrivals_share ON agent.referral_arrivals (share_id);

-- The old tables are superseded. Keep them for one release so nothing that
-- still reads them breaks, then drop. Nothing has written to either yet.
COMMENT ON TABLE agent.referral_shares IS 'SUPERSEDED by agent.shares (phase24). Drop after one release.';
COMMENT ON TABLE agent.offer_shares IS 'SUPERSEDED by agent.shares (phase24). Drop after one release.';
