ALTER TABLE "events" ADD COLUMN "slot_config" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_attendees" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "auto_unbench" boolean DEFAULT true;