import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * WoW Classic dungeon quest data — plugin-owned table for wow-common.
 * Seeded from TyrsDev/WoW-Classic-Quests dataset on plugin install,
 * dropped on plugin uninstall.
 *
 * ROK-245: Variant-Aware Dungeon Quest Database
 */
export const wowClassicDungeonQuests = pgTable('wow_classic_dungeon_quests', {
  id: serial('id').primaryKey(),
  /** Quest ID from the TyrsDev dataset (matches Wowhead quest ID) */
  questId: integer('quest_id').unique().notNull(),
  /** Blizzard Journal instance ID (matches BlizzardService instance IDs) */
  dungeonInstanceId: integer('dungeon_instance_id'),
  /** Quest title */
  name: varchar('name', { length: 255 }).notNull(),
  /** Level of the quest itself */
  questLevel: integer('quest_level'),
  /** Minimum character level required to pick up the quest */
  requiredLevel: integer('required_level'),
  /** Expansion this quest belongs to: 'classic' | 'tbc' | 'wotlk' | 'cata' */
  expansion: varchar('expansion', { length: 20 }).notNull(),
  /** NPC name of the quest giver */
  questGiverNpc: varchar('quest_giver_npc', { length: 255 }),
  /** Zone where the quest giver is located */
  questGiverZone: varchar('quest_giver_zone', { length: 255 }),
  /** Previous quest in the chain (quest_id reference) */
  prevQuestId: integer('prev_quest_id'),
  /** Next quest in the chain (quest_id reference) */
  nextQuestId: integer('next_quest_id'),
  /** Array of reward item IDs */
  rewardsJson: jsonb('rewards_json').$type<number[]>(),
  /** Quest objective text */
  objectives: text('objectives'),
  /** Array of class names that can pick up this quest (null = all classes) */
  classRestriction: jsonb('class_restriction').$type<string[]>(),
  /** Array of race names that can pick up this quest (null = all races) */
  raceRestriction: jsonb('race_restriction').$type<string[]>(),
  /** Whether the quest pickup NPC is inside the dungeon */
  startsInsideDungeon: boolean('starts_inside_dungeon')
    .default(false)
    .notNull(),
  /** Whether the quest can be shared with party members */
  sharable: boolean('sharable').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
