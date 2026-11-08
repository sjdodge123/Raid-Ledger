ALTER TABLE "guild_profiles" ADD COLUMN "ingame_motd" text;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "ingame_motd_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "ingame_motd_updated_by" integer;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "ingame_info" text;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "ingame_info_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "ingame_info_updated_by" integer;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_ingame_motd_updated_by_users_id_fk" FOREIGN KEY ("ingame_motd_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_ingame_info_updated_by_users_id_fk" FOREIGN KEY ("ingame_info_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_ingame_motd_updated_by" ON "guild_profiles" USING btree ("ingame_motd_updated_by");--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_ingame_info_updated_by" ON "guild_profiles" USING btree ("ingame_info_updated_by");--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_ingame_motd_length" CHECK (char_length("guild_profiles"."ingame_motd") <= 255);--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_ingame_info_length" CHECK (char_length("guild_profiles"."ingame_info") <= 499);