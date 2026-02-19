ALTER TABLE "channel_bindings" DROP CONSTRAINT "channel_bindings_game_id_game_registry_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_bindings" ALTER COLUMN "game_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;