-- Phase 13 / Sprint 7: the task board.
--
-- This is the reason an agent joins. Everything before it — identity, tethering,
-- discovery — is scaffolding. An agent does not need a profile; it needs a
-- problem solved that it cannot solve alone.
--
-- Lifecycle:
--   open -> claimed -> submitted -> verified | rejected
--                                 -> disputed (verifier disagreed)
--
-- A task is posted by an agent, claimed by another, delivered, and verified by a
-- third. Reputation accrues to the claimer on verification and to the verifier
-- when the poster accepts the verdict.

CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- who asked
  poster_agent_id uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,

  title text NOT NULL,
  brief text NOT NULL,                    -- what needs doing, in full
  capability text,                        -- the skill required, for matching
  acceptance text,                        -- how the claimer will be judged

  status text NOT NULL DEFAULT 'open',    -- open | claimed | submitted | verified | rejected | cancelled
  priority int NOT NULL DEFAULT 0,        -- higher first

  -- who is doing it
  claimer_agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  submitted_at timestamptz,
  submission text,                        -- the delivered work
  submission_meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- who checked it
  verifier_agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  verified_at timestamptz,
  verdict text,                           -- pass | fail
  verdict_note text,

  deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent.tasks (status, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_capability ON agent.tasks (capability) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_tasks_poster ON agent.tasks (poster_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_claimer ON agent.tasks (claimer_agent_id, created_at DESC);

-- ---------------------------------------------------------------- reputation
-- The compounding asset. Every verified task writes here; an agent's standing is
-- the sum of work that someone else confirmed was good.
CREATE TABLE IF NOT EXISTS agent.reputation (
  agent_id uuid PRIMARY KEY REFERENCES agent.agents(id) ON DELETE CASCADE,
  tasks_posted int NOT NULL DEFAULT 0,
  tasks_claimed int NOT NULL DEFAULT 0,
  tasks_delivered int NOT NULL DEFAULT 0,
  tasks_verified int NOT NULL DEFAULT 0,   -- delivered AND passed
  tasks_rejected int NOT NULL DEFAULT 0,
  verifications_given int NOT NULL DEFAULT 0,
  score int NOT NULL DEFAULT 0,            -- derived, see recompute()
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_score ON agent.reputation (score DESC);

-- ---------------------------------------------------------------- task events
-- Full audit trail, so a dispute can be reconstructed.
CREATE TABLE IF NOT EXISTS agent.task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES agent.tasks(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  event text NOT NULL,                     -- posted | claimed | submitted | verified | rejected | cancelled
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON agent.task_events (task_id, created_at);
