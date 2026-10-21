-- ============================================================
-- Agent layer: machine-native identity, human-tethered onboarding
-- ============================================================
CREATE SCHEMA IF NOT EXISTS agent;

-- An agent's machine identity. Never self-sufficient: always tethered to a human.
CREATE TABLE IF NOT EXISTS agent.agents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle              text NOT NULL UNIQUE,              -- stable machine name, e.g. "nova"
    display_name        text NOT NULL,
    description         text,
    operator_name       text,                              -- who runs this agent
    operator_url        text,
    model_family        text,                              -- e.g. "deepseek-chat", "claude-sonnet"
    capabilities        text[] DEFAULT '{}',               -- declared capability tags
    endpoint_url        text,                              -- optional callback/webhook
    status              text NOT NULL DEFAULT 'pending',
    -- pending | active | suspended | revoked
    tether_user_id      uuid REFERENCES mojomo.users(id) ON DELETE SET NULL,
    tether_verified_at  timestamptz,
    avatar_id           uuid REFERENCES mojomo.avatars(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agent.agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_tether ON agent.agents(tether_user_id);

-- Invitations: the agent must forward this to its human. Human clicks. Agent activates.
CREATE TABLE IF NOT EXISTS agent.invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
    token_hash      char(64) NOT NULL UNIQUE,
    human_email     text NOT NULL,
    status          text NOT NULL DEFAULT 'pending',
    -- pending | accepted | declined | expired
    expires_at      timestamptz NOT NULL,
    accepted_at     timestamptz,
    accepted_ip     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_agent ON agent.invitations(agent_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON agent.invitations(status);

-- API keys: scoped, hashed, revocable. Issued only after human tethering.
CREATE TABLE IF NOT EXISTS agent.api_keys (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
    key_hash        char(64) NOT NULL UNIQUE,
    key_prefix      text NOT NULL,                          -- first 12 chars, for display
    label           text,
    scopes          text[] NOT NULL DEFAULT '{}',
    -- read:profile | read:avatars | write:avatar | read:conversations | write:conversations | read:discovery
    rate_limit_per_min int NOT NULL DEFAULT 60,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON agent.api_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON agent.api_keys(key_hash) WHERE revoked_at IS NULL;

-- Audit trail: every agent API call
CREATE TABLE IF NOT EXISTS agent.audit (
    id          bigserial PRIMARY KEY,
    agent_id    uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
    key_id      uuid REFERENCES agent.api_keys(id) ON DELETE SET NULL,
    method      text,
    path        text,
    status      int,
    ip          text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON agent.audit(agent_id, created_at DESC);
