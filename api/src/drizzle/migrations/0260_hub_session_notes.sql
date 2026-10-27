CREATE TABLE "hub_session_note_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"text" varchar(200) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" integer,
	"done_at" timestamp with time zone,
	CONSTRAINT "hub_session_note_items_text_length" CHECK (char_length("hub_session_note_items"."text") BETWEEN 1 AND 200),
	CONSTRAINT "hub_session_note_items_done_pair" CHECK (("hub_session_note_items"."done" = false) = ("hub_session_note_items"."done_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "hub_session_notes" (
	"guild_id" integer PRIMARY KEY NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"clear_after_event_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_session_notes_body_length" CHECK (char_length("hub_session_notes"."body") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "hub_session_note_items" ADD CONSTRAINT "hub_session_note_items_guild_id_hub_session_notes_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."hub_session_notes"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_session_note_items" ADD CONSTRAINT "hub_session_note_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_session_notes" ADD CONSTRAINT "hub_session_notes_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_session_notes" ADD CONSTRAINT "hub_session_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_session_notes" ADD CONSTRAINT "hub_session_notes_clear_after_event_id_events_id_fk" FOREIGN KEY ("clear_after_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_session_note_items_guild_position" ON "hub_session_note_items" USING btree ("guild_id","position");--> statement-breakpoint
CREATE INDEX "idx_hub_session_note_items_done_by" ON "hub_session_note_items" USING btree ("done_by");--> statement-breakpoint
CREATE INDEX "idx_hub_session_notes_updated_by" ON "hub_session_notes" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "idx_hub_session_notes_clear_after_event" ON "hub_session_notes" USING btree ("clear_after_event_id");