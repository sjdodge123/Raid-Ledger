-- ROK-986: Track IGDB enrichment status for re-enrichment pipeline.
-- Adds two columns to the games table so the cron sync can retry
-- IGDB metadata lookup for ITAD/Steam-sourced games.

ALTER TABLE "games" ADD COLUMN "igdb_enrichment_status" varchar(20) DEFAULT 'pending';
ALTER TABLE "games" ADD COLUMN "igdb_enrichment_retry_count" integer DEFAULT 0 NOT NULL;

-- Backfill: games already enriched via IGDB
UPDATE "games" SET "igdb_enrichment_status" = 'enriched'
  WHERE "igdb_id" IS NOT NULL;

-- Backfill: games with no external ID source (manually created, etc.)
UPDATE "games" SET "igdb_enrichment_status" = 'not_applicable'
  WHERE "igdb_id" IS NULL
    AND "steam_app_id" IS NULL
    AND "itad_game_id" IS NULL;
