DROP INDEX "ad_hoc_participants_event_discord_user_unique";--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ALTER COLUMN "discord_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "steam_id" varchar(32);--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "source" varchar(16) DEFAULT 'discord' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "in_voice" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "on_server" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "pelican_server_id" integer;--> statement-breakpoint
ALTER TABLE "pelican_servers" ADD COLUMN "presence_tracking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_hoc_participants_event_steam_unique" ON "ad_hoc_participants" USING btree ("event_id","steam_id") WHERE "ad_hoc_participants"."steam_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_hoc_participants_event_discord_user_unique" ON "ad_hoc_participants" USING btree ("event_id","discord_user_id") WHERE "ad_hoc_participants"."discord_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD CONSTRAINT "ad_hoc_participants_identity_check" CHECK ("ad_hoc_participants"."discord_user_id" IS NOT NULL OR "ad_hoc_participants"."steam_id" IS NOT NULL);