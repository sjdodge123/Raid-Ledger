DROP INDEX "idx_one_main_per_game";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_one_main_per_game" ON "characters" USING btree ("user_id","game_id") WHERE "characters"."is_main" = true;