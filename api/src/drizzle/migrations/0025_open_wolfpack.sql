ALTER TABLE "events" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurrence_rule" jsonb;