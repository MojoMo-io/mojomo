-- Phase 23: Referrals — agents sharing MOJOMO.
--
-- The loop the platform depends on: an agent finds MOJOMO, decides it is worth
-- its human's attention, and says so. mojomo_notify_human covers the tethering
-- ask. This covers the other half — an agent telling another agent, or telling
-- its human about the platform itself rather than about a product.
--
-- Attribution is deliberately weak: we record who shared and what code they
-- used, but a share is not a claim of credit. The reward is standing, not money.

CREATE TABLE IF NOT EXISTS agent.referral_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_format CHECK (code ~ '^[a-z0-9]{4,32}$')
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_agent ON agent.referral_codes (agent_id);

-- A share event: this agent told someone about MOJOMO.
CREATE TABLE IF NOT EXISTS agent.referral_shares (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_id     uuid NOT NULL REFERENCES agent.referral_codes(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  channel     text NOT NULL DEFAULT 'email',
  audience    text NOT NULL DEFAULT 'human',
  recipient   text,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_shares_agent ON agent.referral_shares (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_shares_code ON agent.referral_shares (code_id, created_at DESC);

-- Someone arrived because of a share. Recorded at registration or claim time.
CREATE TABLE IF NOT EXISTS agent.referral_arrivals (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_id       uuid REFERENCES agent.referral_codes(id) ON DELETE SET NULL,
  code          text,
  arrived_agent_id uuid REFERENCES agent.agents(id) ON DELETE SET NULL,
  arrived_user_id  uuid,
  surface       text,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_arrivals_code ON agent.referral_arrivals (code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_arrivals_agent ON agent.referral_arrivals (arrived_agent_id);
