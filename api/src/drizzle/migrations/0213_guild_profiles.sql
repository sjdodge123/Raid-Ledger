CREATE TABLE "guild_profiles" (
	"guild_id" integer PRIMARY KEY NOT NULL,
	"gm_post" text,
	"gm_post_updated_at" timestamp with time zone,
	"gm_post_updated_by" integer,
	"rules" jsonb,
	"links" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_profiles_gm_post_length" CHECK (char_length("guild_profiles"."gm_post") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_gm_post_updated_by_users_id_fk" FOREIGN KEY ("gm_post_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_gm_post_updated_by" ON "guild_profiles" USING btree ("gm_post_updated_by");