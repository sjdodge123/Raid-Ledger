ALTER TABLE "valheim_profiles" ADD COLUMN "death_count" integer;--> statement-breakpoint
ALTER TABLE "valheim_profiles" ADD COLUMN "death_count_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD COLUMN "player_id" text;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD COLUMN "world_uid" text;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "valheim_player_deaths_reported_uq" ON "valheim_player_deaths" USING btree ("pelican_server_id","steam_id","player_id","reported_at") WHERE "valheim_player_deaths"."reported_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "valheim_player_deaths" ADD CONSTRAINT "valheim_player_deaths_mod_shape_check" CHECK ("valheim_player_deaths"."source" <> 'mod' OR ("valheim_player_deaths"."reported_at" IS NOT NULL AND "valheim_player_deaths"."x" IS NOT NULL AND "valheim_player_deaths"."z" IS NOT NULL AND "valheim_player_deaths"."player_id" IS NOT NULL AND "valheim_player_deaths"."world_uid" IS NOT NULL));