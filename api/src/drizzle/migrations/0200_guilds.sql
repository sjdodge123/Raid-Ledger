CREATE TABLE "guilds" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"region" varchar(10) NOT NULL,
	"name" varchar(64) NOT NULL,
	"name_key" varchar(64) NOT NULL,
	"realm_slug" varchar(100),
	"guild_slug" varchar(100),
	"blizzard_guild_id" bigint,
	"faction" varchar(20),
	"member_count" integer DEFAULT 0 NOT NULL,
	"source" varchar(20) NOT NULL,
	"last_snapshot_at" timestamp with time zone,
	"raw_realm" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" integer NOT NULL,
	"guid" varchar(32),
	"blizzard_character_id" bigint,
	"character_name" varchar(100) NOT NULL,
	"level" integer,
	"class" varchar(50),
	"rank_index" integer,
	"rank_name" varchar(64),
	"public_note" varchar(256),
	"source" varchar(20) NOT NULL,
	"last_seen_at" timestamp with time zone,
	"captured_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guilds_realmless_name" ON "guilds" USING btree ("game_id","region","name_key") WHERE "guilds"."realm_slug" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_guilds_game_id" ON "guilds" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guild_members_guild_guid" ON "guild_members" USING btree ("guild_id","guid") WHERE "guild_members"."guid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_guild_members_guild_id" ON "guild_members" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_guild_members_captured_by_user_id" ON "guild_members" USING btree ("captured_by_user_id");