CREATE TABLE "pug_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" integer NOT NULL,
	"discord_username" varchar(100) NOT NULL,
	"discord_user_id" varchar(50),
	"discord_avatar_hash" varchar(100),
	"role" varchar(20) NOT NULL,
	"class" varchar(50),
	"spec" varchar(50),
	"notes" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"server_invite_url" varchar(500),
	"invited_at" timestamp,
	"claimed_by_user_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_event_pug" UNIQUE("event_id","discord_username")
);
--> statement-breakpoint
ALTER TABLE "pug_slots" ADD CONSTRAINT "pug_slots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pug_slots" ADD CONSTRAINT "pug_slots_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pug_slots" ADD CONSTRAINT "pug_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;