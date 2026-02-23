CREATE TABLE "wow_classic_quest_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"quest_id" integer NOT NULL,
	"picked_up" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_quest_progress_event_user_quest" UNIQUE("event_id","user_id","quest_id")
);
--> statement-breakpoint
ALTER TABLE "wow_classic_quest_progress" ADD CONSTRAINT "wow_classic_quest_progress_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wow_classic_quest_progress" ADD CONSTRAINT "wow_classic_quest_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;