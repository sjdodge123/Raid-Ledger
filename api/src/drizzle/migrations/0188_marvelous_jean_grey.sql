DROP INDEX "idx_game_interests_game_id";--> statement-breakpoint
CREATE INDEX "idx_game_interests_game_id_source_user" ON "game_interests" USING btree ("game_id","source","user_id");