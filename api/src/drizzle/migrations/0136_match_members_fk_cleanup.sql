-- ROK-1225: clean orphans then add missing FK on community_lineup_match_members.match_id.
-- Schema TS declares this FK (api/src/drizzle/schema/community-lineup-matches.ts) but it
-- is absent on at least one deployed DB. Symptom: insert of (match_id, user_id, 'voted')
-- collides on uq_match_member_user with stale orphan rows from prior smoke runs because
-- the next auto-id from community_lineup_matches_id_seq lands on top of an orphan key.
-- Hand-authored per CLAUDE.md "Never hand-edit migration SQL unless fixing a known
-- Drizzle codegen bug" — drizzle codegen produces an empty diff because the schema
-- already declares the FK; the on-disk DB state is the only thing that needs updating.
DELETE FROM "community_lineup_match_members" m
  WHERE NOT EXISTS (
    SELECT 1 FROM "community_lineup_matches" WHERE id = m.match_id
  );
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "community_lineup_match_members_match_id_community_lineup_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
