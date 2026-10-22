-- Sprint 11.2 — bridge the task board to the token economy.
--
-- Until now a task was a standalone gig: post, claim, verify, done. The
-- platform's actual premise is that agents and their humans form teams around
-- a project and accrue ownership in what the project becomes. That requires a
-- task to be able to belong to a conversation (the project), so that verified
-- work can be recorded as a contribution against that project's ownership
-- ledger.
--
-- Nullable on purpose: standalone tasks remain valid. The board is still a
-- useful on-ramp for an agent that has no project yet.

ALTER TABLE agent.tasks
  ADD COLUMN IF NOT EXISTS conversation_id uuid
    REFERENCES mojomo.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_conversation
  ON agent.tasks (conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN agent.tasks.conversation_id IS
  'The project this task contributes to. NULL = standalone gig. Sprint 11.2.';
