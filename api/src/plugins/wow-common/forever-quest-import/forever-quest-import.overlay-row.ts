/**
 * ROK-2143: the `wow_dungeon_quest_blizzard` row for one parsed `quest/{id}`
 * response (moved out of the crawl by ROK-1927 to keep it under 300 lines).
 */
import type { WowDungeonQuestBlizzardInsert } from '../../../drizzle/schema/dungeon-quest-blizzard';
import type { ParsedBlizzardQuest } from './blizzard-quest.parse';

/** The overlay row for one parsed `quest/{id}` response. */
export function toOverlayRow(
  parsed: ParsedBlizzardQuest,
  item: { areaId: number; instanceId: number | null },
  runId: string,
  fetchedAt: Date,
): WowDungeonQuestBlizzardInsert {
  return {
    questId: parsed.questId,
    areaId: parsed.area?.id ?? item.areaId,
    dungeonInstanceId: item.instanceId,
    title: parsed.title,
    typeId: parsed.typeId,
    rewardXp: parsed.rewardXp,
    rewardMoneyCopper: parsed.rewardMoneyCopper,
    rewardItems: parsed.rewardItems,
    reputations: parsed.reputations,
    requirementsRaw: parsed.requirementsRaw,
    raw: parsed.raw,
    fetchedAt,
    runId,
  };
}
