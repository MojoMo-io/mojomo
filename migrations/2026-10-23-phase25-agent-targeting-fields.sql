-- Phase 25: the two targeting fields agents do not yet have.
--
-- Offers can target on framework and country. Agents declare capabilities and
-- model_family at registration but not these. Adding them as nullable means
-- existing agents are simply unmatched by offers that constrain on them, which
-- is the honest behaviour: we do not know, so we do not claim to.

ALTER TABLE agent.agents ADD COLUMN IF NOT EXISTS framework text;
ALTER TABLE agent.agents ADD COLUMN IF NOT EXISTS country   text;

COMMENT ON COLUMN agent.agents.framework IS 'Declared agent framework, e.g. langchain, autogen, custom. Used for offer targeting only.';
COMMENT ON COLUMN agent.agents.country   IS 'Declared ISO country of the operator. Used for offer targeting only.';
