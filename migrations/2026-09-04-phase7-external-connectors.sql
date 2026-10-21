-- Phase 7 (2026-09-04): external data connectors (Google Drive, OneDrive, ...) for
-- personality-profile enrichment. Everything here belongs to exactly one avatar and cascades
-- away completely on disconnect or avatar deletion - this is the "closed data area" design.
-- Idempotent.

CREATE TABLE IF NOT EXISTS mojomo.oauth_states (
  state VARCHAR(64) PRIMARY KEY,
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_avatar ON mojomo.oauth_states(avatar_id);

CREATE TABLE IF NOT EXISTS mojomo.avatar_external_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  account_label TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'connected', -- connected | revoked | error
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (avatar_id, provider)
);

CREATE TABLE IF NOT EXISTS mojomo.avatar_external_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES mojomo.avatar_external_connections(id) ON DELETE CASCADE,
  avatar_id UUID NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_aed_avatar_id ON mojomo.avatar_external_documents(avatar_id);
