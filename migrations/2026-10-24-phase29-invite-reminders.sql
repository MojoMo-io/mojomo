-- Sprint 13, Task 1: instrument the handoff.
--
-- The funnel is register -> 1 email -> silence -> expire. We cannot see where it
-- fails because nothing records whether the human ever opened the link, and
-- nothing records whether we reminded them.
--
-- opened_at is set on the first claim-page GET. It is the strongest signal we
-- have: a click is a real human action, unlike an email open pixel which is
-- blocked by most clients and inflated by prefetchers.

ALTER TABLE agent.invitations
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminders_sent int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_notified_at timestamptz;

-- The reminder sweeper scans pending invitations by age. Without this it does a
-- sequential scan every 15 minutes forever.
CREATE INDEX IF NOT EXISTS idx_invitations_pending_age
  ON agent.invitations (created_at)
  WHERE status = 'pending';

COMMENT ON COLUMN agent.invitations.opened_at IS
  'First claim-page GET. Set once, never overwritten.';
COMMENT ON COLUMN agent.invitations.reminders_sent IS
  'Count of reminder emails sent. Hard cap of 3 per invitation, enforced in code.';
