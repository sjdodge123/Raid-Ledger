CREATE TABLE "guild_loot_drops" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"region" varchar(10) NOT NULL,
	"guild_key" varchar(64) DEFAULT '' NOT NULL,
	"looter_key" varchar(100) NOT NULL,
	"looter_name" varchar(100) NOT NULL,
	"looter_guid" varchar(32),
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"quality" integer,
	"link" varchar(512),
	"method" varchar(10) NOT NULL,
	"instance_id" integer,
	"difficulty_id" integer,
	"encounter_id" integer,
	"encounter_name" varchar(128),
	"dropped_at" timestamp with time zone NOT NULL,
	"at_bucket" integer NOT NULL,
	"reported_by_user_id" integer,
	"reported_by_character_id" uuid,
	"payload_sha256" char(64) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_guild_loot_drops_dedupe" UNIQUE NULLS NOT DISTINCT("game_id","region","guild_key","looter_key","item_id","quantity","at_bucket","instance_id")
);
--> statement-breakpoint
ALTER TABLE "guild_loot_drops" ADD CONSTRAINT "guild_loot_drops_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_loot_drops" ADD CONSTRAINT "guild_loot_drops_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_loot_drops" ADD CONSTRAINT "guild_loot_drops_reported_by_character_id_characters_id_fk" FOREIGN KEY ("reported_by_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_loot_drops_guild_dropped_at" ON "guild_loot_drops" USING btree ("game_id","region","guild_key","dropped_at");--> statement-breakpoint
CREATE INDEX "idx_guild_loot_drops_reported_by_user_id" ON "guild_loot_drops" USING btree ("reported_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_guild_loot_drops_reported_by_character_id" ON "guild_loot_drops" USING btree ("reported_by_character_id");