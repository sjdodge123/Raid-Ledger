ALTER TABLE "characters" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "race" varchar(50);--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "faction" varchar(20);--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "profile_url" text;