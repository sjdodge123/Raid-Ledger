ALTER TABLE "community_lineups" ADD COLUMN "nomination_target_pct" smallint;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "nomination_target_below_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "nomination_target_disarmed_at" timestamp;