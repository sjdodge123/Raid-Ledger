ALTER TABLE "lfg_intents" ADD COLUMN "urgency" text DEFAULT 'week' NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD COLUMN "ttl_minutes" integer;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_urgency_check" CHECK ("lfg_intents"."urgency" IN ('week', 'now'));--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_ttl_minutes_check" CHECK ("lfg_intents"."ttl_minutes" IS NULL OR "lfg_intents"."ttl_minutes" IN (30, 60));