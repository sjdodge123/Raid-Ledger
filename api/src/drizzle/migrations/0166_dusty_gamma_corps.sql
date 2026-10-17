CREATE TABLE "discord_channel_presence_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"voice_channel_id" varchar(255) NOT NULL,
	"binding_id" uuid,
	"text_channel_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"payload_hash" varchar(64),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"empty_since" timestamp,
	"closed_at" timestamp,
	"close_reason" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discord_channel_presence_messages_status_check" CHECK ("discord_channel_presence_messages"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "discord_channel_presence_messages" ADD CONSTRAINT "channel_presence_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."channel_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_presence_open_per_channel" ON "discord_channel_presence_messages" USING btree ("guild_id","voice_channel_id") WHERE "discord_channel_presence_messages"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_channel_presence_binding" ON "discord_channel_presence_messages" USING btree ("binding_id");