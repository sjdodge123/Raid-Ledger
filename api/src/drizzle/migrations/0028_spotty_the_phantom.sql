ALTER TABLE "characters" ADD COLUMN "region" varchar(10);--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "game_variant" varchar(30);--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "equipment" jsonb;