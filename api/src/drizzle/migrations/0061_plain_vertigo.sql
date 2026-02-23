ALTER TABLE "wow_classic_dungeon_quests" ADD COLUMN "reward_xp" integer;--> statement-breakpoint
ALTER TABLE "wow_classic_dungeon_quests" ADD COLUMN "reward_gold" integer;--> statement-breakpoint
ALTER TABLE "wow_classic_dungeon_quests" ADD COLUMN "reward_type" varchar(20) DEFAULT 'none';