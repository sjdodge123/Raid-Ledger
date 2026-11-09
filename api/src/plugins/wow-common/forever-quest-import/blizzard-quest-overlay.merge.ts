/**
 * ROK-2143: field-by-field precedence between a curated quest row (bundled
 * `dungeon-quest-data.json`, re-seeded every boot) and its Blizzard overlay
 * row (`wow_dungeon_quest_blizzard`). Pure; never mutates its inputs.
 *
 * Blizzard wins, when it has a value, for: `name`, `rewardXp`, `rewardGold`
 * (from `rewardMoneyCopper`) and `rewardsJson` (reward item ids). Every other
 * field — `startsInsideDungeon` (ROK-2142 allowlist), `questGiverNpc`,
 * `questGiverZone`, `objectives`, `sharable`, restrictions, `rewardType`,
 * `prevQuestId`/`requiredLevel` (until L5 maps `requirements`) — stays curated.
 * A null overlay (no row, or the kill switch off) returns the row unchanged.
 */
import type { WowDungeonQuestBlizzardRow } from '../../../drizzle/schema/dungeon-quest-blizzard';

/** The overlay columns the merge reads. */
export type BlizzardQuestOverlay = Pick<
  WowDungeonQuestBlizzardRow,
  'title' | 'rewardXp' | 'rewardMoneyCopper' | 'rewardItems'
>;

/** The quest fields Blizzard may override (DB row and DTO both satisfy it). */
export interface OverlayableQuestFields {
  name: string;
  rewardXp: number | null;
  rewardGold: number | null;
  rewardsJson: number[] | null;
}

/**
 * Overlay values win when present. A blank title or an empty reward-item list
 * counts as "no value" (keeps the curated one) — an absent `rewards.items`
 * parses as `[]`, which must not wipe curated rewards.
 */
export function mergeBlizzardOverlay<T extends OverlayableQuestFields>(
  row: T,
  overlay: BlizzardQuestOverlay | null | undefined,
): T {
  if (!overlay) return row;
  const items = overlay.rewardItems;
  return {
    ...row,
    name: overlay.title.trim() !== '' ? overlay.title : row.name,
    rewardXp: overlay.rewardXp ?? row.rewardXp,
    rewardGold: overlay.rewardMoneyCopper ?? row.rewardGold,
    rewardsJson: items.length > 0 ? items.map((i) => i.id) : row.rewardsJson,
  };
}
