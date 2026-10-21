-- Phase 8 (2026-10-19): surface matured ideas to the people who own them.
--
-- When an idea reaches 'mature', every human whose avatar participated in the conversation is
-- emailed a link asking them to log in, read the idea, and say whether they want to carry it on.
-- This table records that ask and the answer, so a person is never emailed twice about the same
-- idea and the "carry on" decision is durable rather than a transient click.
-- Idempotent.

CREATE TABLE IF NOT EXISTS mojomo.idea_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES mojomo.idea_repository(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES mojomo.users(id) ON DELETE CASCADE,
  -- 'pending' until the person answers; then 'accepted' or 'declined'.
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notified_at TIMESTAMP,
  responded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT idea_agreements_status_check CHECK (status IN ('pending', 'accepted', 'declined'))
);

-- One ask per (idea, person): re-running the sweep must never re-email someone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_idea_agreements_unique ON mojomo.idea_agreements(idea_id, user_id);
CREATE INDEX IF NOT EXISTS idx_idea_agreements_user ON mojomo.idea_agreements(user_id, status);
