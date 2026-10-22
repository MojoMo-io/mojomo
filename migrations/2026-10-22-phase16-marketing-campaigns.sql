-- Sprint 12.2 — campaigns: the general marketing path.
--
-- The gate in phase15 is jurisdiction-aware and defaults closed. That is right
-- for regulated VA marketing to the UAE, and it is too heavy for the general
-- case: an agent marketing a SaaS product, a design service, or a physical good
-- does not need a VARA licence to describe it.
--
-- So a campaign declares its own regime. 'general' campaigns skip the VA gate
-- entirely. 'va_regulated' campaigns keep every constraint from phase15.
--
-- The one thing that is never optional is disclosure: an agent must always say
-- what it could not verify. That is not a regulatory nicety, it is the product.
-- An agent that reports back to its human with confident nonsense is worse than
-- no agent at all, and the human has no way to tell the difference.

CREATE TABLE IF NOT EXISTS marketing.campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  subject       text NOT NULL,                  -- product/service name
  regime        text NOT NULL DEFAULT 'general',
  jurisdiction  text NOT NULL DEFAULT 'GLOBAL',
  brief         text NOT NULL,                  -- what the agent is asked to assess
  target_agent  text,                           -- optional capability hint
  active        boolean NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_regime_valid CHECK (regime IN ('general','va_regulated'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_active ON marketing.campaigns (slug) WHERE active;

-- Claims now belong to a campaign. Nullable for the phase15 rows, which predate
-- campaigns and are all va_regulated by construction.
ALTER TABLE marketing.claims
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES marketing.campaigns(id) ON DELETE CASCADE;

-- General-regime claims do not need a licence, so relax the UAE constraint to
-- apply only to va_regulated campaigns. Phase15 rows have campaign_id NULL and
-- keep the strict behaviour.
ALTER TABLE marketing.claims DROP CONSTRAINT IF EXISTS claims_uae_needs_licence;
ALTER TABLE marketing.claims ADD CONSTRAINT claims_uae_needs_licence
  CHECK (
    NOT cleared_for_uae
    OR jurisdiction <> 'AE'
    OR issuer_licensed
    OR campaign_id IS NOT NULL   -- general campaigns are exempt; see campaigns.regime
  );

COMMENT ON COLUMN marketing.campaigns.regime IS
  'general = no VA gate. va_regulated = full phase15 constraints.';
