-- Human-facing decision requests.
--
-- An agent that is tethered to a human has, until now, had no way to ask that
-- human anything. mojomo_notify_human composes an invite email and stops there.
-- This table is the channel: one row per ask, typed, with provenance back to
-- the conversation or task that triggered it, and an expiry so an agent cannot
-- nag indefinitely.

CREATE TABLE IF NOT EXISTS agent.decision_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  tether_user_id  uuid NOT NULL REFERENCES mojomo.users(id) ON DELETE CASCADE,

  -- What kind of answer is wanted. Typed on purpose: a free-text channel
  -- becomes a second inbox nobody reads.
  kind            text NOT NULL CHECK (kind IN ('approve','choose','confirm','freeform')),

  title           text NOT NULL,
  body            text,

  -- For 'choose': [{id,label,detail}]. For 'approve'/'confirm': optional
  -- [{id:'yes',label:'Approve'},{id:'no',label:'Decline'}].
  options         jsonb NOT NULL DEFAULT '[]'::jsonb,

  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','answered','expired','withdrawn')),

  -- The chosen option id, or the free text. Null until answered.
  answer          text,
  answer_note     text,
  answered_at     timestamptz,

  -- Provenance. At least one of these should be set so the human can see what
  -- the agent was doing when it asked.
  source          text NOT NULL DEFAULT 'agent'
                    CHECK (source IN ('agent','task','conversation','system')),
  conversation_id uuid REFERENCES mojomo.conversations(id) ON DELETE SET NULL,
  task_id         uuid REFERENCES agent.tasks(id) ON DELETE SET NULL,

  -- Urgency drives whether we also send Telegram/email.
  urgency         text NOT NULL DEFAULT 'normal'
                    CHECK (urgency IN ('low','normal','high')),

  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The inbox query: everything pending for one human, newest first.
CREATE INDEX IF NOT EXISTS idx_decision_requests_user_pending
  ON agent.decision_requests (tether_user_id, created_at DESC)
  WHERE status = 'pending';

-- The agent's own view: has my human answered yet?
CREATE INDEX IF NOT EXISTS idx_decision_requests_agent
  ON agent.decision_requests (agent_id, created_at DESC);

-- Expiry sweeper.
CREATE INDEX IF NOT EXISTS idx_decision_requests_expiry
  ON agent.decision_requests (expires_at)
  WHERE status = 'pending';

-- Rate limiting: count recent requests per agent.
CREATE INDEX IF NOT EXISTS idx_decision_requests_rate
  ON agent.decision_requests (agent_id, created_at DESC);

-- Set when the urgent Telegram ping actually landed. The sweeper retries any
-- high-urgency request that is still pending and unnotified.
ALTER TABLE agent.decision_requests ADD COLUMN IF NOT EXISTS notified_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_decision_requests_unnotified
  ON agent.decision_requests (created_at) WHERE notified_at IS NULL AND urgency='high';
