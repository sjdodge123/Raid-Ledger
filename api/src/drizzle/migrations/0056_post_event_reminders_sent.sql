-- ROK-403: Track post-event onboarding reminders sent to PUG participants
CREATE TABLE IF NOT EXISTS "post_event_reminders_sent" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"pug_slot_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_post_event_pug_reminder" UNIQUE("event_id","pug_slot_id")
);
--> statement-breakpoint
ALTER TABLE "post_event_reminders_sent" ADD CONSTRAINT "post_event_reminders_sent_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_event_reminders_sent" ADD CONSTRAINT "post_event_reminders_sent_pug_slot_id_pug_slots_id_fk" FOREIGN KEY ("pug_slot_id") REFERENCES "public"."pug_slots"("id") ON DELETE cascade ON UPDATE no action;
