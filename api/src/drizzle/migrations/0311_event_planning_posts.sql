CREATE TABLE "event_planning_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" integer NOT NULL,
	"forum_id" integer NOT NULL,
	"discord_thread_id" varchar(32) NOT NULL,
	"closes_at" timestamp with time zone,
	"discord_locked_at" timestamp with time zone,
	"discord_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_event_planning_posts_discord_thread_id" UNIQUE("discord_thread_id"),
	CONSTRAINT "event_planning_posts_subject_kind" CHECK ("event_planning_posts"."subject_kind" IN ('event', 'poll', 'lineup'))
);
--> statement-breakpoint
ALTER TABLE "hub_forum_threads" DROP CONSTRAINT "hub_forum_threads_event_detached";--> statement-breakpoint
ALTER TABLE "hub_forum_threads" DROP CONSTRAINT "hub_forum_threads_write_closes";--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "match_id" integer;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "lineup_id" integer;--> statement-breakpoint
ALTER TABLE "event_planning_posts" ADD CONSTRAINT "event_planning_posts_forum_id_fk" FOREIGN KEY ("forum_id") REFERENCES "public"."hub_forum_discord_forums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_planning_posts_subject_live" ON "event_planning_posts" USING btree ("subject_kind","subject_id") WHERE "event_planning_posts"."discord_deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_event_planning_posts_forum_id" ON "event_planning_posts" USING btree ("forum_id");--> statement-breakpoint
CREATE INDEX "idx_event_planning_posts_closes_at" ON "event_planning_posts" USING btree ("closes_at") WHERE "event_planning_posts"."discord_locked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_threads_match_live" ON "hub_forum_threads" USING btree ("match_id") WHERE "hub_forum_threads"."match_id" IS NOT NULL AND "hub_forum_threads"."event_detached_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_threads_lineup_live" ON "hub_forum_threads" USING btree ("lineup_id") WHERE "hub_forum_threads"."lineup_id" IS NOT NULL AND "hub_forum_threads"."event_detached_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_one_subject" CHECK (num_nonnulls("hub_forum_threads"."event_id", "hub_forum_threads"."match_id", "hub_forum_threads"."lineup_id") <= 1);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_event_detached" CHECK ("hub_forum_threads"."event_detached_at" IS NULL OR num_nonnulls("hub_forum_threads"."event_id", "hub_forum_threads"."match_id", "hub_forum_threads"."lineup_id") = 1);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_write_closes" CHECK ("hub_forum_threads"."write_closes_at" IS NULL OR num_nonnulls("hub_forum_threads"."event_id", "hub_forum_threads"."match_id", "hub_forum_threads"."lineup_id") = 1);