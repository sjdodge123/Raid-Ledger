/**
 * ROK-2143: field-by-field precedence between a curated quest row (bundled
 * `dungeon-quest-data.json`, re-seeded every boot) and its Blizzard overlay
 * row (`wow_dungeon_quest_blizzard`). Pure; never mutates its inputs.
 *
 * Blizzard wins, when it has a value, for: `name`, `rewardXp`, `rewardGold`
 * (from `rewardMoneyCopper`), `rewardsJson` (reward item ids) and — mapped
 * from `requirements_raw` (L6, see `blizzard-quest.requirements.ts`) —
 * `prevQuestId`, `classRestriction` and `raceRestriction` (a faction becomes
 * its race list). Every other field — `startsInsideDungeon` (ROK-2142
 * allowlist), `questGiverNpc`, `questGiverZone`, `objectives`, `sharable`,
 * `rewardType`, `requiredLevel` (Blizzard serves no level) — stays curated.
 * ROK-2161: non-zero `reputations` become `reputationRewards` (the key is
 * omitted when there are none).
 * A null overlay (no row, or the kill switch off) returns the row unchanged.
 */
import type {
  BlizzardQuestReputation,
  WowDungeonQuestBlizzardRow,
} from '../../../drizzle/schema/dungeon-quest-blizzard';
import type { QuestReputationReward } from '../dungeon-quests.types';
import { requirementFields } from './blizzard-quest.requirements';

/** The overlay columns the merge reads. */
export type BlizzardQuestOverlay = Pick<
  WowDungeonQuestBlizzardRow,
  | 'questId'
  | 'title'
  | 'rewardXp'
  | 'rewardMoneyCopper'
  | 'rewardItems'
  | 'reputations'
  | 'requirementsRaw'
>;

/**
 * ROK-2161: `{ reputationRewards }` from the overlay's non-zero reputations
 * that carry a faction name (a blank name would render "+150 " with nothing
 * after it), or `{}` when none — spread it so the key is absent rather than undefined.
 */
export function reputationRewardFields(
  reputations: readonly BlizzardQuestReputation[],
): { reputationRewards?: QuestReputationReward[] } {
  const rewards = reputations
    .filter((rep) => rep.value !== 0 && rep.name.trim() !== '')
    .map((rep) => ({ factionName: rep.name, amount: rep.value }));
  return rewards.length > 0 ? { reputationRewards: rewards } : {};
}

/** The quest fields Blizzard may override (DB row and DTO both satisfy it). */
export interface OverlayableQuestFields {
  name: string;
  rewardXp: number | null;
  rewardGold: number | null;
  rewardsJson: number[] | null;
  prevQuestId: number | null;
  classRestriction: string[] | null;
  raceRestriction: string[] | null;
}

/**
 * Overlay values win when present. A blank title or an empty reward-item list
 * counts as "no value" (keeps the curated one) — an absent `rewards.items`
 * parses as `[]`, which must not wipe curated rewards. Likewise an empty
 * `requirements` (`{}`) keeps the curated prerequisite and restrictions.
 */
export function mergeBlizzardOverlay<T extends OverlayableQuestFields>(
  row: T,
  overlay: BlizzardQuestOverlay | null | undefined,
): T {
  if (!overlay) return row;
  const items = overlay.rewardItems;
  const req = requirementFields(overlay.requirementsRaw, overlay.questId);
  return {
    ...row,
    name: overlay.title.trim() !== '' ? overlay.title : row.name,
    rewardXp: overlay.rewardXp ?? row.rewardXp,
    rewardGold: overlay.rewardMoneyCopper ?? row.rewardGold,
    rewardsJson: items.length > 0 ? items.map((i) => i.id) : row.rewardsJson,
    prevQuestId: req.prevQuestId ?? row.prevQuestId,
    classRestriction: req.classRestriction ?? row.classRestriction,
    raceRestriction: req.raceRestriction ?? row.raceRestriction,
    ...reputationRewardFields(overlay.reputations),
  };
}
