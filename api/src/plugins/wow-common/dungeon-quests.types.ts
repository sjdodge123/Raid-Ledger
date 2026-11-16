/**
 * Dungeon quest type definitions.
 * Extracted from dungeon-quests.service.ts for file size compliance (ROK-711).
 */
import type { EnrichedQuestReward } from '@raid-ledger/contract';

export interface DungeonQuestDto {
  questId: number;
  dungeonInstanceId: number | null;
  name: string;
  questLevel: number | null;
  requiredLevel: number | null;
  expansion: string;
  questGiverNpc: string | null;
  questGiverZone: string | null;
  prevQuestId: number | null;
  nextQuestId: number | null;
  rewardsJson: number[] | null;
  objectives: string | null;
  classRestriction: string[] | null;
  raceRestriction: string[] | null;
  startsInsideDungeon: boolean;
  sharable: boolean;
  rewardXp: number | null;
  rewardGold: number | null;
  rewardType: string | null;
  /** ROK-2161: non-zero Blizzard reputation rewards; key absent when none. */
  reputationRewards?: QuestReputationReward[];
  /**
   * ROK-1908: the dungeon's catalogue level band — only on an imported quest
   * with no level of its own; absent on curated quests.
   */
  levelBand?: QuestLevelBand | null;
  /** ROK-2224: true on an escort quest (ESCORT_QUEST_IDS); key absent otherwise. */
  isEscort?: boolean;
}

/** A dungeon's catalogue level span (ROK-1908). */
export interface QuestLevelBand {
  min: number;
  max: number;
}

/** One reputation reward on a quest card (ROK-2161). */
export interface QuestReputationReward {
  factionName: string;
  amount: number;
}

export interface EnrichedDungeonQuestDto extends DungeonQuestDto {
  rewards: EnrichedQuestReward[] | null;
  prerequisiteChain: DungeonQuestDto[] | null;
}
