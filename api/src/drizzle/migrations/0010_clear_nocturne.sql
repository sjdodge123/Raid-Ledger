CREATE TABLE "roster_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"signup_id" integer NOT NULL,
	"role" varchar(20),
	"position" integer DEFAULT 1 NOT NULL,
	"is_override" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_event_signup" UNIQUE("event_id","signup_id")
);
--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_signup_id_event_signups_id_fk" FOREIGN KEY ("signup_id") REFERENCES "public"."event_signups"("id") ON DELETE cascade ON UPDATE no action;