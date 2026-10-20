ALTER TABLE "channel_bindings" ADD COLUMN "lifecycle_state" varchar(10) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "auto_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "restore_parent_id" varchar(32);--> statement-breakpoint
CREATE INDEX "idx_channel_bindings_lifecycle" ON "channel_bindings" USING btree ("guild_id","game_id","lifecycle_state") WHERE "channel_bindings"."auto_managed" AND "channel_bindings"."recurrence_group_id" IS NULL;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_lifecycle_state_check" CHECK ("channel_bindings"."lifecycle_state" IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_archived_auto_check" CHECK ("channel_bindings"."lifecycle_state" = 'active' OR "channel_bindings"."auto_managed");