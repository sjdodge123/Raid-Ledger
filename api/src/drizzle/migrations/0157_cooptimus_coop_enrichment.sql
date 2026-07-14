ALTER TABLE "games" ADD COLUMN "cooptimus_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_online_max" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_couch_max" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_lan_max" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_splitscreen" boolean;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_drop_in" boolean;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_campaign_coop" boolean;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_combo_coop" boolean;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_url" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_extras" jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooptimus_synced_at" timestamp;