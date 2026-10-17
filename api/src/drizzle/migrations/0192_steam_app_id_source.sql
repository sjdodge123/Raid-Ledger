-- ROK-1680 (RH-7a) — provenance tag for games.steam_app_id
--
-- Adds `steam_app_id_source` (varchar(16) NULL; steam | itad | igdb | manual;
-- NULL = unknown) to games.
--
-- Hand-edited after drizzle-kit generate: drizzle-kit cannot emit triggers or
-- data backfills. Appended after the generated ALTER:
--   1. games_steam_app_id_source_reset() + a BEFORE UPDATE trigger: when an
--      UPDATE changes steam_app_id but leaves steam_app_id_source as it was
--      (untouched, or the same tag re-written), the source falls to NULL, so a
--      write path that forgets to tag can never leave a stale provenance.
--   2. SQL-only backfill: the four rows 0156 corrected by hand are tagged
--      'manual', matched on name + the corrected id. Every other row stays NULL.
ALTER TABLE "games" ADD COLUMN "steam_app_id_source" varchar(16);--> statement-breakpoint
CREATE OR REPLACE FUNCTION games_steam_app_id_source_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.steam_app_id IS DISTINCT FROM OLD.steam_app_id AND NEW.steam_app_id_source IS NOT DISTINCT FROM OLD.steam_app_id_source THEN NEW.steam_app_id_source := NULL; END IF; RETURN NEW; END $$;--> statement-breakpoint
CREATE TRIGGER games_steam_app_id_source_reset BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION games_steam_app_id_source_reset();--> statement-breakpoint
UPDATE games SET steam_app_id_source = 'manual' WHERE (name, steam_app_id) IN (('7 Days to Die',251570),('Risk of Rain 2',632360),('Divinity: Original Sin II - Definitive Edition',435150),('Black Desert Online',582660));
