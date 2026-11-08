ALTER TABLE "guild_profiles" ADD COLUMN "game_motd" text;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "game_motd_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "game_motd_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "game_info" text;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "game_info_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "game_info_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_game_motd_length" CHECK (char_length("guild_profiles"."game_motd") <= 255);--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_game_info_length" CHECK (char_length("guild_profiles"."game_info") <= 499);