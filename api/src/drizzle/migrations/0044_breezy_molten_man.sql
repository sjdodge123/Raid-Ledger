CREATE TABLE "discord_event_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" integer NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"embed_state" varchar(30) DEFAULT 'posted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_event_guild" UNIQUE("event_id","guild_id")
);
--> statement-breakpoint
ALTER TABLE "discord_event_messages" ADD CONSTRAINT "discord_event_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discord_event_messages_event" ON "discord_event_messages" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_discord_event_messages_message" ON "discord_event_messages" USING btree ("guild_id","channel_id","message_id");