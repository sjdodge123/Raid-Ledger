ALTER TABLE "hub_forum_threads" ADD COLUMN "event_id" integer;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "event_detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "write_closes_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_threads_event_live" ON "hub_forum_threads" USING btree ("event_id") WHERE "hub_forum_threads"."event_id" IS NOT NULL AND "hub_forum_threads"."event_detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_event_id" ON "hub_forum_threads" USING btree ("event_id") WHERE "hub_forum_threads"."event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_event_detached" CHECK ("hub_forum_threads"."event_detached_at" IS NULL OR "hub_forum_threads"."event_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_write_closes" CHECK ("hub_forum_threads"."write_closes_at" IS NULL OR "hub_forum_threads"."event_id" IS NOT NULL);