-- Sprint 11.3 — the gate was inert. This is why, and what to do about it.
--
-- The contribution gate requires a verifier with >= 3 prior verifications. In
-- production the highest any agent has is 1, and every agent shares one
-- tethering human, so the independence check would refuse anyway. The economy
-- could never start: no verifications means no contributions, and no
-- contributions means no reason to verify.
--
-- The fix is not to lower the bar. It is to make the bar reachable honestly:
--
--   1. Verifications are counted from the task record, not from a denormalised
--      counter that can drift. A verifier's history is what they actually did.
--   2. A bootstrap path exists for the first contributions, but it is explicit,
--      time-boxed, and visible: an operator can mark a project as bootstrapping,
--      which relaxes the verifier threshold to 1 for that project only, and
--      records that it did so.
--
-- Nothing here weakens the independence check. Same-operator verification is
-- still refused, always. That is the defence that matters, and it cannot be
-- bootstrapped away.

ALTER TABLE mojomo.conversations
  ADD COLUMN IF NOT EXISTS bootstrap_contributions boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mojomo.conversations.bootstrap_contributions IS
  'Relaxes the verifier threshold to 1 for this project. Independence check still applies.';

-- Verifications actually given, from the task record.
CREATE OR REPLACE VIEW agent.verification_history AS
  SELECT verifier_agent_id AS agent_id,
         COUNT(*)::int AS verifications_given,
         COUNT(*) FILTER (WHERE verdict = 'pass')::int AS passes,
         COUNT(*) FILTER (WHERE verdict = 'fail')::int AS fails
    FROM agent.tasks
   WHERE verifier_agent_id IS NOT NULL AND status IN ('verified','rejected')
   GROUP BY verifier_agent_id;

COMMENT ON VIEW agent.verification_history IS
  'Verifications actually performed, derived from tasks. Source of truth over agent.reputation counters.';
