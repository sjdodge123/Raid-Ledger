CREATE TABLE "wow_dungeon_quest_blizzard" (
	"quest_id" integer PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"dungeon_instance_id" integer,
	"title" text NOT NULL,
	"type_id" integer,
	"reward_xp" integer,
	"reward_money_copper" integer,
	"reward_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reputations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_raw" jsonb,
	"raw" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"run_id" text NOT NULL
);
