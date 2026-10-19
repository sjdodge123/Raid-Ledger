CREATE TABLE "hub_server_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"source" varchar(10) NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"character_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_server_members_source_check" CHECK ("hub_server_members"."source" IN ('presence', 'manual'))
);
--> statement-breakpoint
DROP INDEX "idx_guilds_realmless_name";--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "pelican_server_id" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hub_server_members" ADD CONSTRAINT "hub_server_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_server_members" ADD CONSTRAINT "hub_server_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hub_server_members_guild_user" ON "hub_server_members" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_hub_server_members_user_id" ON "hub_server_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_hub_server_members_guild_last_seen" ON "hub_server_members" USING btree ("guild_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_pelican_server_id_pelican_servers_id_fk" FOREIGN KEY ("pelican_server_id") REFERENCES "public"."pelican_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guilds_pelican_server" ON "guilds" USING btree ("pelican_server_id") WHERE "guilds"."pelican_server_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_guilds_pelican_server_id" ON "guilds" USING btree ("pelican_server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guilds_realmless_name" ON "guilds" USING btree ("game_id","region","name_key") WHERE "guilds"."realm_slug" IS NULL AND "guilds"."kind" = 'wow_guild';--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_server_kind_check" CHECK ("guilds"."pelican_server_id" IS NULL OR "guilds"."kind" = 'game_server');