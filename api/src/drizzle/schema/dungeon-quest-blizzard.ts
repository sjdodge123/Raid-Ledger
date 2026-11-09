import { pgTable, integer, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/** One embedded reward item from the Blizzard quest response. */
export interface BlizzardQuestRewardItem {
  id: number;
  name: string;
}

/** One reputation reward from the Blizzard quest response. */
export interface BlizzardQuestReputation {
  factionId: number;
  name: string;
  value: number;
}

/**
 * ROK-2143: overlay of classic dungeon quest data fetched from the Blizzard
 * WoW: Forever API (`quest/{id}`) — plugin-owned by wow-common. The boot
 * seeder never touches it (unlike `wow_classic_dungeon_quests`); the quest
 * read path lets non-null values here win field by field. Upserted on
 * `quest_id`; a quest absent from a later run keeps its row and is reported
 * stale (its `run_id` differs from the latest run). No FK.
 */
export const wowDungeonQuestBlizzard = pgTable('wow_dungeon_quest_blizzard', {
  questId: integer('quest_id').primaryKey(),
  /** Blizzard quest-area id the quest was listed under (or reached from). */
  areaId: integer('area_id').notNull(),
  /** Our dungeon instance id from the area map; null for out-of-area prereqs. */
  dungeonInstanceId: integer('dungeon_instance_id'),
  title: text('title').notNull(),
  typeId: integer('type_id'),
  rewardXp: integer('reward_xp'),
  rewardMoneyCopper: integer('reward_money_copper'),
  rewardItems: jsonb('reward_items')
    .$type<BlizzardQuestRewardItem[]>()
    .default([])
    .notNull(),
  reputations: jsonb('reputations')
    .$type<BlizzardQuestReputation[]>()
    .default([])
    .notNull(),
  /** The whole `requirements` object, verbatim (shape learned in L5). */
  requirementsRaw: jsonb('requirements_raw').$type<unknown>(),
  /** The whole response minus `_links`. */
  raw: jsonb('raw').$type<unknown>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  /** Import run that last wrote this row. */
  runId: text('run_id').notNull(),
});

export type WowDungeonQuestBlizzardRow =
  typeof wowDungeonQuestBlizzard.$inferSelect;
export type WowDungeonQuestBlizzardInsert =
  typeof wowDungeonQuestBlizzard.$inferInsert;
