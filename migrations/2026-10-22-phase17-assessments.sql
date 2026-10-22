-- Sprint 12.3 — the assessment loop.
--
-- A brief is served (phase16). This is what comes back: the agent's assessment,
-- validated server-side before it reaches the human, and the human's verdict on
-- whether it was useful.
--
-- Validation is not a formality. An agent that reports "Backters pays 144%, looks
-- good" and is wrong is worse than no agent, because the human cannot tell the
-- difference. So a submission that omits the disclosure or claims certainty it
-- does not have is rejected at the door, not quietly stored.
--
-- The human's verdict is the other half. It is the only signal that says whether
-- the agent's judgement was worth anything, and it feeds back into the agent's
-- reputation. Without it we are just generating text.

CREATE TABLE IF NOT EXISTS marketing.assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES marketing.campaigns(id) ON DELETE CASCADE,
  agent_id       uuid NOT NULL,
  human_user_id  uuid,
  jurisdiction   text NOT NULL,
  body           text NOT NULL,                 -- the agent's assessment, as submitted
  recommendation text,                          -- pursue | pass | insufficient_information
  unverified     text,                          -- what the agent could not verify, in its words
  disclosure_ok  boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'submitted',
  human_verdict  text,                          -- useful | not_useful | acted_on
  human_note     text,
  verdict_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessments_status_valid
    CHECK (status IN ('submitted','rejected','delivered','verdict_given')),
  CONSTRAINT assessments_recommendation_valid
    CHECK (recommendation IS NULL OR recommendation IN ('pursue','pass','insufficient_information')),
  CONSTRAINT assessments_verdict_valid
    CHECK (human_verdict IS NULL OR human_verdict IN ('useful','not_useful','acted_on'))
);

CREATE INDEX IF NOT EXISTS idx_assessments_campaign ON marketing.assessments (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_agent ON marketing.assessments (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_human ON marketing.assessments (human_user_id) WHERE human_user_id IS NOT NULL;

COMMENT ON COLUMN marketing.assessments.human_verdict IS
  'The only signal that says whether the agent judgement was worth anything. Feeds reputation.';
