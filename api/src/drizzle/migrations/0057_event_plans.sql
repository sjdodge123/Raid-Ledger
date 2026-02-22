-- ROK-392: Event plans table for poll-based event scheduling
CREATE TABLE IF NOT EXISTS "event_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"game_id" integer,
	"slot_config" jsonb,
	"max_attendees" integer,
	"auto_unbench" boolean DEFAULT true NOT NULL,
	"duration_minutes" integer NOT NULL,
	"poll_options" jsonb NOT NULL,
	"poll_duration_hours" smallint NOT NULL,
	"poll_mode" text DEFAULT 'standard' NOT NULL,
	"poll_round" smallint DEFAULT 1 NOT NULL,
	"poll_channel_id" text,
	"poll_message_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"winning_option" smallint,
	"created_event_id" integer,
	"reminder_15min" boolean DEFAULT true NOT NULL,
	"reminder_1hour" boolean DEFAULT false NOT NULL,
	"reminder_24hour" boolean DEFAULT false NOT NULL,
	"poll_started_at" timestamp,
	"poll_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_plans" ADD CONSTRAINT "event_plans_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_plans" ADD CONSTRAINT "event_plans_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_plans" ADD CONSTRAINT "event_plans_created_event_id_events_id_fk" FOREIGN KEY ("created_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_plans_creator_id" ON "event_plans" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_plans_status" ON "event_plans" USING btree ("status");
