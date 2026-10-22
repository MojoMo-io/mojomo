-- Sprint 12 — external agent marketing, compliance-first.
--
-- An agent that tells its human "Backters pays 144%" is, under VARA's Marketing
-- Regulations 2024, marketing a virtual asset to a UAE person. Those rules apply
-- to all VA marketing targeting the UAE, domestic and foreign, licensed or not,
-- and marketing may only be done by or on behalf of a VARA-licensed VASP.
--
-- So the platform does not carry marketing copy. It carries *claims*: each one
-- sourced, dated, jurisdiction-tagged, and cleared by a human before any agent
-- may see it. The gate defaults closed. An empty table means nothing is served.
--
-- The educational exemption is the only path that does not require the issuer to
-- be licensed, and it only holds if the content is non-promotional and carries
-- proper risk disclosure. That is enforced in code (12.3), not by convention.

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS marketing.claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text NOT NULL,              -- e.g. 'backters'
  claim_text        text NOT NULL,              -- the exact wording an agent may use
  source_url        text NOT NULL,
  source_verified_at timestamptz NOT NULL,      -- when a human last checked the source
  jurisdiction      text NOT NULL DEFAULT 'AE', -- ISO-ish; 'AE' = UAE/Dubai
  issuer_licensed   boolean NOT NULL DEFAULT false,
  licence_ref       text,                       -- VARA licence reference, if any
  cleared_for_uae   boolean NOT NULL DEFAULT false,
  cleared_by        text,                       -- human who cleared it
  cleared_at        timestamptz,
  withdrawn_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_cleared_needs_human
    CHECK (NOT cleared_for_uae OR (cleared_by IS NOT NULL AND cleared_at IS NOT NULL)),
  CONSTRAINT claims_uae_needs_licence
    CHECK (NOT cleared_for_uae OR jurisdiction <> 'AE' OR issuer_licensed)
);

CREATE INDEX IF NOT EXISTS idx_claims_subject_cleared
  ON marketing.claims (subject) WHERE cleared_for_uae AND withdrawn_at IS NULL;

-- Every claim served to an agent, to which human, when. VARA requires third-party
-- marketing records be kept for 8 years; this table is append-only by convention
-- and must never be pruned.
CREATE TABLE IF NOT EXISTS marketing.servings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       uuid NOT NULL REFERENCES marketing.claims(id),
  agent_id       uuid NOT NULL,
  human_user_id  uuid,
  jurisdiction   text NOT NULL,
  task_id        uuid,
  served_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_servings_claim ON marketing.servings (claim_id);
CREATE INDEX IF NOT EXISTS idx_servings_agent ON marketing.servings (agent_id);
CREATE INDEX IF NOT EXISTS idx_servings_served ON marketing.servings (served_at DESC);

COMMENT ON TABLE marketing.servings IS
  'Append-only audit trail. VARA third-party marketing record-keeping: 8 years. Do not prune.';
