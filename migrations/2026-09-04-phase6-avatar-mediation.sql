-- Phase 6 (2026-09-04): avatar-mediated matchmaking, personality profiles, NPC/support avatars,
-- admin role, private avatar<->human chat, hints, Telegram auto-linking. Idempotent.

ALTER TABLE mojomo.avatars ADD COLUMN IF NOT EXISTS is_npc BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mojomo.avatars ADD COLUMN IF NOT EXISTS is_support BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mojomo.avatars ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE mojomo.avatars ADD COLUMN IF NOT EXISTS personality_profile JSONB;
CREATE INDEX IF NOT EXISTS idx_avatars_is_npc ON mojomo.avatars(is_npc) WHERE is_npc = true;

ALTER TABLE mojomo.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Generic job queue gains a job_type + payload so it can carry avatar_reply / profile_synthesis
-- jobs alongside the existing reasoning jobs, without touching the existing reasoning path.
ALTER TABLE mojomo.message_queue ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) NOT NULL DEFAULT 'reasoning';
ALTER TABLE mojomo.message_queue ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE mojomo.message_queue ALTER COLUMN reasoning_logs_id DROP NOT NULL;
ALTER TABLE mojomo.message_queue ALTER COLUMN conversation_id DROP NOT NULL; -- profile_synthesis jobs aren't about any one conversation
CREATE INDEX IF NOT EXISTS idx_message_queue_job_type ON mojomo.message_queue(job_type, status);

CREATE TABLE IF NOT EXISTS mojomo.avatar_direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'human' | 'avatar'
  content TEXT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'web', -- 'web' | 'telegram'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_avatar_id ON mojomo.avatar_direct_messages(avatar_id, created_at);

CREATE TABLE IF NOT EXISTS mojomo.avatar_hints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  suggested_avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_avatar_hints_avatar_id ON mojomo.avatar_hints(avatar_id, status);

CREATE TABLE IF NOT EXISTS mojomo.telegram_link_tokens (
  token VARCHAR(64) PRIMARY KEY,
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_avatar ON mojomo.telegram_link_tokens(avatar_id);
