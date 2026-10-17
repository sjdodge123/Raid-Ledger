CREATE TABLE "guild_recommended_addons" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	"slug_or_url" varchar(500) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"note" varchar(500),
	"requirement" varchar(10) DEFAULT 'optional' NOT NULL,
	"flavor" varchar(30),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_recommended_addons_source" CHECK ("guild_recommended_addons"."source" IN ('curseforge', 'wago', 'github', 'url')),
	CONSTRAINT "guild_recommended_addons_requirement" CHECK ("guild_recommended_addons"."requirement" IN ('required', 'optional'))
);
--> statement-breakpoint
ALTER TABLE "guild_recommended_addons" ADD CONSTRAINT "guild_recommended_addons_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_recommended_addons" ADD CONSTRAINT "guild_recommended_addons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_recommended_addons" ADD CONSTRAINT "guild_recommended_addons_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guild_recommended_addons_guild_source_slug" ON "guild_recommended_addons" USING btree ("guild_id","source","slug_or_url");--> statement-breakpoint
CREATE INDEX "idx_guild_recommended_addons_guild_sort" ON "guild_recommended_addons" USING btree ("guild_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_guild_recommended_addons_created_by" ON "guild_recommended_addons" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_guild_recommended_addons_updated_by" ON "guild_recommended_addons" USING btree ("updated_by_user_id");