ALTER TABLE "guild_profiles" ADD COLUMN "discord_channel_id" varchar(32);--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "discord_channel_private_ack" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "discord_channel_set_by" integer;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "discord_channel_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_discord_channel_set_by_users_id_fk" FOREIGN KEY ("discord_channel_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_discord_channel_set_by" ON "guild_profiles" USING btree ("discord_channel_set_by");