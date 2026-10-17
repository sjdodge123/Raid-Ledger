-- ROK-818: Add ITAD pricing columns to games table for cron-synced pricing data.
ALTER TABLE "games" ADD COLUMN "itad_current_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_current_cut" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_current_shop" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_current_url" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_lowest_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_lowest_cut" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_price_updated_at" timestamp;
