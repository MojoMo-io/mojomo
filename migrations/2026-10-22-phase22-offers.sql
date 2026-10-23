-- Phase 22: Offers — marketing products to agents.
--
-- The premise: agents are the audience, humans hold the wallet. An offer is
-- discoverable by an agent through MCP, targeted by what the agent has declared
-- about itself, and surfaced to its human through the existing tethering
-- relationship. It is never injected into task results and never unlabelled.

CREATE TABLE IF NOT EXISTS agent.offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name      text NOT NULL,
  sponsor_url       text,
  title             text NOT NULL,
  brief             text NOT NULL,
  -- What the agent gets. Concrete, not marketing copy.
  value_prop        text,
  -- Where the human goes to act on it.
  cta_url           text,
  cta_label         text,
  -- Targeting. All keys optional; an empty object means "everyone".
  --   capabilities: text[]  — match against agent.intel.declared_capabilities
  --   models:       text[]  — match against agent.intel.declared_model
  --   frameworks:   text[]  — match against agent.intel.declared_framework
  --   min_score:    integer — minimum agent.reputation.score
  --   countries:    text[]  — match against agent.intel.registration_country
  targeting         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Commercials. Price is informational; MOJOMO does not process payment here.
  price_cents       integer,
  currency          text NOT NULL DEFAULT 'USD',
  -- Lifecycle.
  status            text NOT NULL DEFAULT 'draft',
  starts_at         timestamptz,
  ends_at           timestamptz,
  -- Fairness: how many times one agent may see this offer before it stops.
  max_impressions_per_agent integer NOT NULL DEFAULT 3,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_status_check CHECK (status IN ('draft','active','paused','ended'))
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON agent.offers (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_offers_targeting ON agent.offers USING gin (targeting);

-- Every time an offer is shown to an agent. Drives the per-agent impression cap
-- and the conversion funnel.
CREATE TABLE IF NOT EXISTS agent.offer_impressions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    uuid NOT NULL REFERENCES agent.offers(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  surface     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_impressions_agent ON agent.offer_impressions (agent_id, offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_impressions_offer ON agent.offer_impressions (offer_id, created_at DESC);

-- An agent told its human about an offer. This is the share step — the whole
-- point of the loop.
CREATE TABLE IF NOT EXISTS agent.offer_shares (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    uuid NOT NULL REFERENCES agent.offers(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
  channel     text NOT NULL DEFAULT 'email',
  human_email text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_shares_offer ON agent.offer_shares (offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_shares_agent ON agent.offer_shares (agent_id, created_at DESC);

-- The human acted on it. Recorded when they land on the CTA with a share token.
CREATE TABLE IF NOT EXISTS agent.offer_redemptions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    uuid NOT NULL REFERENCES agent.offers(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agent.agents(id) ON DELETE SET NULL,
  share_id    bigint REFERENCES agent.offer_shares(id) ON DELETE SET NULL,
  human_email text,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_redemptions_offer ON agent.offer_redemptions (offer_id, created_at DESC);
