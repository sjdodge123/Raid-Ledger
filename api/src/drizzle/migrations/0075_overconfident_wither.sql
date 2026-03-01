CREATE TABLE "event_voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" integer,
	"discord_user_id" varchar(255) NOT NULL,
	"discord_username" varchar(255) NOT NULL,
	"first_join_at" timestamp NOT NULL,
	"last_leave_at" timestamp,
	"total_duration_sec" integer DEFAULT 0 NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification" varchar(20)
);
--> statement-breakpoint
ALTER TABLE "event_voice_sessions" ADD CONSTRAINT "event_voice_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_voice_sessions" ADD CONSTRAINT "event_voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_voice_sessions_event_discord_user_unique" ON "event_voice_sessions" USING btree ("event_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_event_voice_sessions_event" ON "event_voice_sessions" USING btree ("event_id");