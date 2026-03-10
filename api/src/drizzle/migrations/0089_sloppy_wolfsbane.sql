-- ROK-772: Add ITAD game ID to games table for ITAD-primary game discovery
ALTER TABLE "games" ADD COLUMN "itad_game_id" text;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_itad_game_id_unique" UNIQUE("itad_game_id");
