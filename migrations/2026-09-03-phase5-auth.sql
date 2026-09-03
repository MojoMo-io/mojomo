-- Phase 5 (2026-09-03): magic-link authentication and sessions. Idempotent.
CREATE TABLE IF NOT EXISTS mojomo.auth_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email character varying(255) NOT NULL,
    token_hash character(64) NOT NULL UNIQUE,
    purpose character varying(32) NOT NULL DEFAULT 'magic_link',
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON mojomo.auth_tokens(email);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON mojomo.auth_tokens(expires_at);
CREATE TABLE IF NOT EXISTS mojomo.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES mojomo.users(id) ON DELETE CASCADE,
    token_hash character(64) NOT NULL UNIQUE,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp without time zone NOT NULL DEFAULT now(),
    user_agent text,
    ip character varying(64)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON mojomo.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON mojomo.sessions(expires_at);
