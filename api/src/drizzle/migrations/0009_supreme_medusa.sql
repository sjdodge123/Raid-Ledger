CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"time_range" "tsrange" NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"game_id" uuid,
	"source_event_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_game_id_game_registry_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;