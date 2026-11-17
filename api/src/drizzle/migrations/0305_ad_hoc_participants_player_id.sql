ALTER TABLE "ad_hoc_participants" DROP CONSTRAINT "ad_hoc_participants_identity_check";--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "player_id" text;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD COLUMN "id_kind" text;--> statement-breakpoint
UPDATE "ad_hoc_participants" SET "player_id" = "steam_id", "id_kind" = 'steam' WHERE "steam_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_hoc_participants_event_player_unique" ON "ad_hoc_participants" USING btree ("event_id","id_kind","player_id") WHERE "ad_hoc_participants"."player_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD CONSTRAINT "ad_hoc_participants_player_kind_check" CHECK (("ad_hoc_participants"."player_id" IS NULL) = ("ad_hoc_participants"."id_kind" IS NULL));--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD CONSTRAINT "ad_hoc_participants_identity_check" CHECK ("ad_hoc_participants"."discord_user_id" IS NOT NULL OR "ad_hoc_participants"."steam_id" IS NOT NULL OR "ad_hoc_participants"."player_id" IS NOT NULL);