CREATE TABLE "hub_forum_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"guild_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"deleted_as" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_forum_replies_body_length" CHECK (char_length("hub_forum_replies"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "hub_forum_replies_deleted_as" CHECK ("hub_forum_replies"."deleted_as" IN ('author', 'moderator')),
	CONSTRAINT "hub_forum_replies_deleted_pair" CHECK (("hub_forum_replies"."deleted_at" IS NULL) = ("hub_forum_replies"."deleted_as" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "hub_forum_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"author_id" integer,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"pinned_at" timestamp with time zone,
	"pinned_by" integer,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"deleted_as" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_forum_threads_title_length" CHECK (char_length("hub_forum_threads"."title") BETWEEN 1 AND 120),
	CONSTRAINT "hub_forum_threads_body_length" CHECK (char_length("hub_forum_threads"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "hub_forum_threads_reply_count" CHECK ("hub_forum_threads"."reply_count" >= 0),
	CONSTRAINT "hub_forum_threads_deleted_as" CHECK ("hub_forum_threads"."deleted_as" IN ('author', 'moderator')),
	CONSTRAINT "hub_forum_threads_deleted_pair" CHECK (("hub_forum_threads"."deleted_at" IS NULL) = ("hub_forum_threads"."deleted_as" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_thread_id_hub_forum_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."hub_forum_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_replies" ADD CONSTRAINT "hub_forum_replies_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_forum_threads" ADD CONSTRAINT "hub_forum_threads_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_thread" ON "hub_forum_replies" USING btree ("thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_guild_id" ON "hub_forum_replies" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_author_id" ON "hub_forum_replies" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_replies_deleted_by" ON "hub_forum_replies" USING btree ("deleted_by");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_feed" ON "hub_forum_threads" USING btree ("guild_id","last_activity_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_pinned" ON "hub_forum_threads" USING btree ("guild_id","pinned_at" DESC NULLS LAST) WHERE "hub_forum_threads"."pinned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_author_id" ON "hub_forum_threads" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_pinned_by" ON "hub_forum_threads" USING btree ("pinned_by");--> statement-breakpoint
CREATE INDEX "idx_hub_forum_threads_deleted_by" ON "hub_forum_threads" USING btree ("deleted_by");