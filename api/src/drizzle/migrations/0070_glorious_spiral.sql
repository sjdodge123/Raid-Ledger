CREATE TABLE "ad_hoc_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" integer,
	"discord_user_id" varchar(255) NOT NULL,
	"discord_username" varchar(255) NOT NULL,
	"discord_avatar_hash" varchar(255),
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"total_duration_seconds" integer,
	"session_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_ad_hoc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ad_hoc_status" varchar(20);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "channel_binding_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD CONSTRAINT "ad_hoc_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_hoc_participants" ADD CONSTRAINT "ad_hoc_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_hoc_participants_event_discord_user_unique" ON "ad_hoc_participants" USING btree ("event_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_ad_hoc_participants_event" ON "ad_hoc_participants" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_ad_hoc_participants_user" ON "ad_hoc_participants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_channel_binding_id_channel_bindings_id_fk" FOREIGN KEY ("channel_binding_id") REFERENCES "public"."channel_bindings"("id") ON DELETE set null ON UPDATE no action;