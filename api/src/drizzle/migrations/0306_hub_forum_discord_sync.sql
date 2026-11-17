CREATE TABLE "hub_forum_discord_bindings" (
	"guild_id" integer PRIMARY KEY NOT NULL,
	"forum_id" integer NOT NULL,
	"tag_id" varchar(32),
	"ack_by" integer,
	"ack_at" timestamp with time zone NOT NULL,
	"bound_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_forum_discord_forums" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_guild_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"managed" boolean DEFAULT false NOT NULL,
	"webhook_id" varchar(32),
	"webhook_token_enc" text,
	"require_tag_set" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_forum_discord_forums_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "hub_forum_discord_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"kind" varchar(8) NOT NULL,
	"thread_id" integer NOT NULL,
	"reply_id" integer,
	"discord_thread_id" varchar(32) NOT NULL,
	"discord_message_id" varchar(32) NOT NULL,
	"origin" varchar(12) NOT NULL,
	"sync_state" varchar(8) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"synced_at" timestamp with time zone,
	"discord_deleted_at" timestamp with time zone,
	"discord_locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_forum_discord_links_discord_message_id_unique" UNIQUE("discord_message_id"),
	CONSTRAINT "hub_forum_discord_links_kind" CHECK ("hub_forum_discord_links"."kind" IN ('thread', 'reply')),
	CONSTRAINT "hub_forum_discord_links_kind_reply" CHECK (("hub_forum_discord_links"."kind" = 'reply') = ("hub_forum_discord_links"."reply_id" IS NOT NULL)),
	CONSTRAINT "hub_forum_discord_links_origin" CHECK ("hub_forum_discord_links"."origin" IN ('raidledger', 'discord')),
	CONSTRAINT "hub_forum_discord_links_sync_state" CHECK ("hub_forum_discord_links"."sync_state" IN ('pending', 'synced', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "hub_forum_discord_notices" (
	"discord_thread_id" varchar(32) PRIMARY KEY NOT NULL,
	"forum_id" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "author_discord_id" varchar(32);--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "author_discord_name" varchar(100);--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD COLUMN "author_discord_avatar" varchar(64);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "author_discord_id" varchar(32);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "author_discord_name" varchar(100);--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD COLUMN "author_discord_avatar" varchar(64);--> statement-breakpoint
ALTER TABLE "hub_forum_discord_bindings" ADD CONSTRAINT "hub_forum_discord_bindings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_bindings" ADD CONSTRAINT "hub_forum_discord_bindings_forum_id_hub_forum_discord_forums_id_fk" FOREIGN KEY ("forum_id") REFERENCES "public"."hub_forum_discord_forums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_bindings" ADD CONSTRAINT "hub_forum_discord_bindings_ack_by_users_id_fk" FOREIGN KEY ("ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_links" ADD CONSTRAINT "hub_forum_discord_links_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_links" ADD CONSTRAINT "hub_forum_discord_links_thread_id_hub_forum_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."hub_forum_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_links" ADD CONSTRAINT "hub_forum_discord_links_reply_id_hub_forum_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."hub_forum_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_discord_notices" ADD CONSTRAINT "hub_forum_discord_notices_forum_id_hub_forum_discord_forums_id_fk" FOREIGN KEY ("forum_id") REFERENCES "public"."hub_forum_discord_forums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_discord_bindings_forum_tag" ON "hub_forum_discord_bindings" USING btree ("forum_id","tag_id") WHERE "hub_forum_discord_bindings"."tag_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_discord_bindings_forum_id" ON "hub_forum_discord_bindings" USING btree ("forum_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_discord_bindings_ack_by" ON "hub_forum_discord_bindings" USING btree ("ack_by");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_discord_links_thread" ON "hub_forum_discord_links" USING btree ("thread_id") WHERE "hub_forum_discord_links"."kind" = 'thread';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hub_forum_discord_links_reply" ON "hub_forum_discord_links" USING btree ("reply_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_discord_links_retry" ON "hub_forum_discord_links" USING btree ("sync_state") WHERE "hub_forum_discord_links"."origin" = 'raidledger' AND "hub_forum_discord_links"."sync_state" <> 'synced';--> statement-breakpoint
CREATE INDEX "idx_hub_forum_discord_links_guild_id" ON "hub_forum_discord_links" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_discord_links_discord_thread" ON "hub_forum_discord_links" USING btree ("discord_thread_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_author_discord_id" ON "hub_forum_replies" USING btree ("author_discord_id") WHERE "hub_forum_replies"."author_discord_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_author_discord_id" ON "hub_forum_threads" USING btree ("author_discord_id") WHERE "hub_forum_threads"."author_discord_id" IS NOT NULL;