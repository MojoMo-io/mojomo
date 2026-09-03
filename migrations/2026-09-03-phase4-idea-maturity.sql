-- Phase 4 (2026-09-03): idea maturity gates and refinement history. Idempotent.
ALTER TABLE mojomo.idea_repository ADD COLUMN IF NOT EXISTS refinement_count integer NOT NULL DEFAULT 0;
ALTER TABLE mojomo.idea_repository ADD COLUMN IF NOT EXISTS surfaced_at timestamp without time zone;
CREATE TABLE IF NOT EXISTS mojomo.idea_refinements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id uuid NOT NULL REFERENCES mojomo.idea_repository(id) ON DELETE CASCADE,
    avatar_id uuid NOT NULL REFERENCES mojomo.avatars(id) ON DELETE CASCADE,
    previous_hypothesis text NOT NULL,
    new_hypothesis text NOT NULL,
    note text,
    confidence_score numeric(5,2),
    created_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idea_refinements_idea ON mojomo.idea_refinements(idea_id);
