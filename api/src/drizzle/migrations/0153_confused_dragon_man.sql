CREATE TABLE "post_event_followup_sent" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"prompt_sent_at" timestamp DEFAULT now() NOT NULL,
	"choice" varchar(20),
	"attendees_notified_at" timestamp,
	CONSTRAINT "unique_post_event_followup" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "post_event_followup_sent" ADD CONSTRAINT "post_event_followup_sent_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;