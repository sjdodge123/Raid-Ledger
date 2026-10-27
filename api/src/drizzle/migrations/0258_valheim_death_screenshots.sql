ALTER TABLE "valheim_player_deaths" DROP CONSTRAINT "valheim_player_deaths_source_check";--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "media_channel_id" varchar(32);--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "media_channel_set_by" integer;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "media_channel_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD COLUMN "hub_media_id" bigint;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_media_channel_set_by_users_id_fk" FOREIGN KEY ("media_channel_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD CONSTRAINT "valheim_player_deaths_hub_media_id_hub_media_id_fk" FOREIGN KEY ("hub_media_id") REFERENCES "public"."hub_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_profiles_media_channel_uq" ON "guild_profiles" USING btree ("media_channel_id") WHERE "guild_profiles"."media_channel_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_media_channel_set_by" ON "guild_profiles" USING btree ("media_channel_set_by");--> statement-breakpoint
CREATE UNIQUE INDEX "valheim_player_deaths_media_uq" ON "valheim_player_deaths" USING btree ("hub_media_id");--> statement-breakpoint
CREATE INDEX "valheim_player_deaths_server_name_time_idx" ON "valheim_player_deaths" USING btree ("pelican_server_id",lower("character_name"),"occurred_at");--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD CONSTRAINT "valheim_player_deaths_source_check" CHECK ("valheim_player_deaths"."source" IN ('log', 'mod', 'discord'));