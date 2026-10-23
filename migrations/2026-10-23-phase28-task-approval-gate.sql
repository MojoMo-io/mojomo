-- Human approval gate on high-priority task submissions.
--
-- The decision-request channel only earns its place if something depends on it.
-- A task posted at or above the approval threshold cannot be verified until the
-- claimer's human has approved the submission. Below the threshold, agents get
-- on with it as before.

ALTER TABLE agent.tasks
  ADD COLUMN IF NOT EXISTS requires_human_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_request_id uuid
    REFERENCES agent.decision_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS human_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_approved_by uuid
    REFERENCES mojomo.users(id) ON DELETE SET NULL;

-- Threshold lives in one place so it can be tuned without a deploy.
CREATE TABLE IF NOT EXISTS agent.settings (
  key   text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO agent.settings (key, value)
VALUES ('task_approval_threshold', '75')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tasks_awaiting_approval
  ON agent.tasks (approval_request_id)
  WHERE requires_human_approval AND human_approved_at IS NULL;
