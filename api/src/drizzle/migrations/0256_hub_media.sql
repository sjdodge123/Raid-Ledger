CREATE TABLE "hub_media" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"provenance_key" text NOT NULL,
	"discord_channel_id" varchar(32),
	"discord_message_id" varchar(32),
	"discord_attachment_id" varchar(32),
	"author_name" text,
	"caption" text,
	"captured_at" timestamp with time zone NOT NULL,
	"storage_name" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" integer,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_media_source_check" CHECK ("hub_media"."source" IN ('discord')),
	CONSTRAINT "hub_media_kind_check" CHECK ("hub_media"."kind" IN ('death', 'screenshot', 'image'))
);
--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_media" ADD CONSTRAINT "hub_media_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_media_provenance_uq" ON "hub_media" USING btree ("guild_id","provenance_key");--> statement-breakpoint
CREATE INDEX "hub_media_feed_idx" ON "hub_media" USING btree ("guild_id","captured_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "hub_media"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "hub_media_feed_kind_idx" ON "hub_media" USING btree ("guild_id","kind","captured_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "hub_media"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "hub_media_hidden_by_idx" ON "hub_media" USING btree ("hidden_by");