-- A retried poll must not leave an agent keyless.
--
-- The key is stored hashed, so a second poll cannot return the same key. Before
-- this, a poll that timed out after the server had already consumed the pickup
-- left the agent with nothing and no way back except asking its human.
--
-- Now a poll after the first one mints a fresh key and revokes the previous,
-- but only within a short window and a bounded number of times, so a leaked
-- invite token cannot be used as a key factory.
ALTER TABLE agent.invitations
  ADD COLUMN IF NOT EXISTS key_pickup_count int NOT NULL DEFAULT 0;
