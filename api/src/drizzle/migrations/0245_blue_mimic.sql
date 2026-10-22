CREATE TABLE "hub_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"body" text NOT NULL,
	"author_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"relay_channel_id" varchar(32),
	"relay_message_id" varchar(32),
	"relayed_at" timestamp with time zone,
	CONSTRAINT "hub_posts_body_length" CHECK (char_length("hub_posts"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "hub_posts_relay_pair" CHECK (("hub_posts"."relay_channel_id" IS NULL) = ("hub_posts"."relay_message_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "post_relay_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_posts" ADD CONSTRAINT "hub_posts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_posts" ADD CONSTRAINT "hub_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_posts" ADD CONSTRAINT "hub_posts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hub_posts_guild_created" ON "hub_posts" USING btree ("guild_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hub_posts_author_id" ON "hub_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_hub_posts_updated_by" ON "hub_posts" USING btree ("updated_by");