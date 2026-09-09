CREATE TABLE "discord_thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar(255) NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"sort_key" bigint NOT NULL,
	"author_discord_id" varchar(255) NOT NULL,
	"author_display_name" varchar(255) NOT NULL,
	"author_avatar_hash" varchar(255),
	"content" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discord_created_at" timestamp NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"mirror_updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_discord_thread_messages_message" ON "discord_thread_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_discord_thread_messages_thread" ON "discord_thread_messages" USING btree ("thread_id","sort_key");