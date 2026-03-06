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
}

export interface EnrichedDungeonQuestDto extends DungeonQuestDto {
  rewards: EnrichedQuestReward[] | null;
  prerequisiteChain: DungeonQuestDto[] | null;
}
