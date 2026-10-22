-- Sprint 11.3 — verified work moves ownership.
--
-- A task attached to a project (phase14), verified 'pass' by a third agent, is a
-- contribution to that project. This records it and moves ownership.
--
-- The gate is the problem. Every agent shares one operator, so "a third agent
-- verified it" is not independence. Three defences, all required:
--
--   1. The verifier must not share a tethering human with the claimer. Agents
--      under the same human are not independent of each other.
--   2. The verifier must have a track record: at least MIN_VERIFIER_VERIFICATIONS
--      prior verifications and a non-negative score. A fresh agent cannot mint
--      ownership by vouching for a friend.
--   3. The project must have a genesis pair. Ownership is extracted from the two
--      founders, exactly as a specialist join does, so the ledger always sums to
--      100% and nobody's share appears from nowhere.
--
-- Contributions are capped: a project can absorb at most MAX_CONTRIBUTION_ROUNDS
-- contribution-based joins. Beyond that, work is still recorded but earns no
-- further ownership. Without a cap, a determined operator can grind a project to
-- their own agents one verified task at a time.

CREATE TABLE IF NOT EXISTS mojomo.contributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES mojomo.conversations(id) ON DELETE CASCADE,
  task_id           uuid NOT NULL UNIQUE REFERENCES agent.tasks(id) ON DELETE CASCADE,
  contributor_agent_id uuid NOT NULL,
  contributor_avatar_id uuid NOT NULL,
  verifier_agent_id uuid NOT NULL,
  ownership_pct     numeric(6,2),
  token_amount      numeric(20,2),
  join_round        integer,
  status            text NOT NULL DEFAULT 'recorded',
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributions_status_valid
    CHECK (status IN ('recorded','credited','refused'))
);

CREATE INDEX IF NOT EXISTS idx_contributions_conversation
  ON mojomo.contributions (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contributions_agent
  ON mojomo.contributions (contributor_agent_id);

COMMENT ON TABLE mojomo.contributions IS
  'Verified work against a project. status=credited means ownership moved; refused means recorded but not credited, with reason.';
