ALTER TABLE "events" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancellation_reason" text;