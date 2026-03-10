ALTER TABLE "games" ADD COLUMN "itad_boxart_url" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_tags" jsonb DEFAULT '[]'::jsonb;