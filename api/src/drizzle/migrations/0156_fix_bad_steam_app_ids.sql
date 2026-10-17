-- Fix three wrong games.steam_app_id values (ROK-1396, surfaced by the
-- ROK-275 Co-Optimus spike's cross-source audit; each verified against
-- Steam's live appdetails API 2026-07-14):
--   7 Days to Die                                730 (Counter-Strike's id) -> 251570
--   Risk of Rain 2                           3885090                       -> 632360
--   Divinity: Original Sin II - Definitive    380370                       -> 435150
--   Black Desert Online                       706220 (dead app id)         -> 582660
-- ("Rust" = 252490 was audited too and confirmed correct; untouched.)
--
-- Predicates match name + the specific wrong id, so installs that never had
-- the bad value (or already fixed it by hand) no-op. games.steam_app_id is
-- UNIQUE: the NOT EXISTS guard makes the migration safe even if some install
-- already has a row holding the correct id (we'd rather keep the wrong value
-- on the duplicate than fail the whole deploy's migration chain).
-- Purge steam-library ownership/playtime rows DERIVED from the wrong ids
-- (Codex P2): a user who owns app 730 (Counter-Strike) got a permanent
-- false "owns 7 Days to Die" interest row, and SteamService.syncLibrary
-- never deletes non-matching rows. Anchored on name + the OLD wrong id and
-- ordered BEFORE the updates so installs that never carried the bad
-- mappings are untouched. The next library sync recreates legitimate rows.
DELETE FROM game_interests gi
 USING games g
 WHERE gi.game_id = g.id
   AND gi.source = 'steam_library'
   AND ((g.name = '7 Days to Die' AND g.steam_app_id = 730)
     OR (g.name = 'Risk of Rain 2' AND g.steam_app_id = 3885090)
     OR (g.name = 'Divinity: Original Sin II - Definitive Edition' AND g.steam_app_id = 380370)
     OR (g.name = 'Black Desert Online' AND g.steam_app_id = 706220));
--> statement-breakpoint
UPDATE games SET steam_app_id = 251570
 WHERE name = '7 Days to Die' AND steam_app_id = 730
   AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.steam_app_id = 251570);
--> statement-breakpoint
UPDATE games SET steam_app_id = 632360
 WHERE name = 'Risk of Rain 2' AND steam_app_id = 3885090
   AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.steam_app_id = 632360);
--> statement-breakpoint
UPDATE games SET steam_app_id = 435150
 WHERE name = 'Divinity: Original Sin II - Definitive Edition' AND steam_app_id = 380370
   AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.steam_app_id = 435150);
--> statement-breakpoint
UPDATE games SET steam_app_id = 582660
 WHERE name = 'Black Desert Online' AND steam_app_id = 706220
   AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.steam_app_id = 582660);
