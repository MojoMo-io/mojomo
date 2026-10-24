-- Let the agent collect its own key after tethering.
--
-- The human used to be handed a key and told to paste it into their agent's
-- config. That made the human a courier for a secret the agent could fetch
-- itself: the agent already holds the invite token it registered with, so it
-- can ask whether the tether happened and pick the key up directly.
--
-- key_pickup_hash is set at accept time and cleared on first pickup, so the
-- key can be collected exactly once. key_picked_up_at records when.
ALTER TABLE agent.invitations
  ADD COLUMN IF NOT EXISTS key_pickup_hash text,
  ADD COLUMN IF NOT EXISTS key_picked_up_at timestamptz;
