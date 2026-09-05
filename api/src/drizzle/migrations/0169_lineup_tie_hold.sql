ALTER TABLE "community_lineups" ADD COLUMN "tie_detected_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_game_ids" jsonb;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_vote_count" integer;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_expired_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_pick_game_id" integer;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_pick_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_pick_by" integer;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_announce_channel_id" text;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "tie_announce_message_id" text;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_tie_pick_game_id_games_id_fk" FOREIGN KEY ("tie_pick_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_tie_pick_by_users_id_fk" FOREIGN KEY ("tie_pick_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lineup_tie_expires" ON "community_lineups" USING btree ("tie_expires_at") WHERE "community_lineups"."tie_detected_at" IS NOT NULL AND "community_lineups"."tie_expired_at" IS NULL;