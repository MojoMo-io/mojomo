-- Decision-level audit trail for EU AI Act Art 19 / Art 26 evidence.
-- agent.audit logs HTTP requests (method/path/status/ip). That is not an
-- oversight record. This table records what was decided, by whom, when,
-- and chains each row to its predecessor so tampering is detectable.

CREATE TABLE IF NOT EXISTS agent.decision_events (
  id            bigserial PRIMARY KEY,
  decision_id   uuid REFERENCES agent.decision_requests(id) ON DELETE RESTRICT,
  agent_id      uuid NOT NULL REFERENCES agent.agents(id) ON DELETE RESTRICT,
  human_user_id uuid,
  event         text NOT NULL,          -- created | notified | answered | expired | withdrawn
  actor         text NOT NULL,          -- agent | human | system
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text,
  row_hash      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_events_decision ON agent.decision_events(decision_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_agent    ON agent.decision_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_events_human    ON agent.decision_events(human_user_id, created_at DESC);

-- Append-only: no UPDATE, no DELETE. Evidence you can edit is not evidence.
CREATE OR REPLACE FUNCTION agent.decision_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent.decision_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_events_immutable ON agent.decision_events;
CREATE TRIGGER trg_decision_events_immutable
  BEFORE UPDATE OR DELETE ON agent.decision_events
  FOR EACH ROW EXECUTE FUNCTION agent.decision_events_immutable();
