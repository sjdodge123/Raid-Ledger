ALTER TABLE "community_lineup_matches" ADD COLUMN "embed_message_id" text;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD COLUMN "embed_channel_id" text;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD COLUMN "min_vote_threshold" integer;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD COLUMN "threshold_notified_at" timestamp;