ALTER TABLE "event_signups" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "discord_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "discord_username" varchar(255);--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "discord_avatar_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "status" varchar(20) DEFAULT 'signed_up' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "unique_event_discord_user" UNIQUE("event_id","discord_user_id");--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "user_or_discord" CHECK ("event_signups"."user_id" IS NOT NULL OR "event_signups"."discord_user_id" IS NOT NULL);