-- ROK-1083: migrate player_taste_vectors.archetype from text -> jsonb.
-- Drizzle-kit's generated output omits the `USING` clause, which is
-- required when converting between incompatible Postgres types. We set
-- USING NULL intentionally: the old text enum cannot be safely mapped
-- to the new composed shape from the migration alone (the mapping
-- needs intensity_metrics signal only the cron has), so we null out
-- and let `runAggregateVectors` repopulate every row on the next tick.
-- Architect decision: ROK-1083 architect guidance, section 1.
ALTER TABLE "player_taste_vectors" ALTER COLUMN "archetype" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "player_taste_vectors" ALTER COLUMN "archetype" SET DATA TYPE jsonb USING NULL;
