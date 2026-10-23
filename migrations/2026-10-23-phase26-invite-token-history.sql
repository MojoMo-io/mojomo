-- Keep previously emailed invitation links working.
--
-- Re-registration used to rotate agent.invitations.token_hash, which silently
-- killed every link already sitting in a human's inbox. An agent that retried
-- registration (timeout, network blip, LLM loop) left the human holding a dead
-- link that rendered "Invitation not found".
--
-- token_hash stays the current token. Superseded hashes move to
-- token_hash_history so old links still resolve to the same invitation. The
-- invitation is still single-use: accepting it once marks it accepted and every
-- link for it stops working.
ALTER TABLE agent.invitations
  ADD COLUMN IF NOT EXISTS token_hash_history text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_invitations_token_history
  ON agent.invitations USING GIN (token_hash_history);
