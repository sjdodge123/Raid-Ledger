/**
 * ROK-2143: the quest read path's Blizzard overlay. Curated rows (the bundled
 * JSON, re-seeded every boot) are merged field by field with the
 * `wow_dungeon_quest_blizzard` overlay, which the boot seeder never touches —
 * so imported values survive `seedQuests()`. R4 = include: an overlay row
 * mapped to the dungeon but missing from our JSON becomes its own quest.
 * With the `wow_forever_quest_import` kill switch off nothing here runs and
 * the curated rows come back unchanged (full rollback without a deploy).
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  wowDungeonQuestBlizzard,
  type WowDungeonQuestBlizzardRow,
} from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import { INSIDE_DUNGEON_QUEST_IDS } from './data/dungeon-quest-inside-allowlist';
import { listBlizzardOverlay } from './forever-quest-import/blizzard-quest.repo';
import { mergeBlizzardOverlay } from './forever-quest-import/blizzard-quest-overlay.merge';
import { requirementFields } from './forever-quest-import/blizzard-quest.requirements';
import { isForeverQuestImportEnabled } from './forever-quest-import/forever-quest-import-switch';
import type { DungeonQuestDto } from './dungeon-quests.types';

/** What the overlay reads: the DB and the kill-switch setting. */
export interface QuestOverlayDeps {
  db: PostgresJsDatabase<typeof schema>;
  settings: Pick<SettingsService, 'get'>;
}

/** The overlay is classic data; overlay-only quests carry this expansion. */
export const OVERLAY_ONLY_EXPANSION = 'classic';

/**
 * R4 ("include, after L5 confirms `type` = Dungeon") — the Blizzard quest
 * `type.id`s an overlay-only quest may have to become a card.
 *
 * Evidence (L5 live run 2, 2026-11-09, 312 quests in the mapped dungeon
 * areas): type_id 81: 282 · 62: 12 · 1: 4 · NULL: 14. The raw responses name
 * 81 `"Dungeon"` (quests 378, 1486). 62 and 1 were not named in anything
 * captured; Blizzard's QuestInfo ids are 1 = Group, 62 = Raid, 81 = Dungeon.
 * Allowed: 81 (Dungeon) and 1 (Group — a group quest filed under the
 * dungeon's area). Excluded: 62 (Raid — e.g. the UBRS raid quests filed
 * under Blackrock Spire, not 5-player dungeon prep) and NULL (an ordinary
 * quest with no type; R4 says exclude non-dungeon types). A curated quest is
 * never filtered by this — it only gates quests our JSON lacks.
 */
export const OVERLAY_ONLY_TYPE_IDS: ReadonlySet<number> = new Set([81, 1]);

export function isOverlayOnlyType(typeId: number | null): boolean {
  return typeId !== null && OVERLAY_ONLY_TYPE_IDS.has(typeId);
}

/**
 * A quest Blizzard lists for the dungeon that our JSON lacks (R4).
 * `rewardType` follows the curated rows: any reward item → `'choice'`
 * (the bundled JSON uses `'choice'` for single-item quests too; the card only
 * says "Choose one reward" when there is more than one), none → `'none'`.
 */
export function overlayOnlyDto(
  row: WowDungeonQuestBlizzardRow,
): DungeonQuestDto {
  const itemIds = row.rewardItems.map((item) => item.id);
  const req = requirementFields(row.requirementsRaw, row.questId);
  return {
    questId: row.questId,
    dungeonInstanceId: row.dungeonInstanceId,
    name: row.title,
    questLevel: null,
    requiredLevel: null,
    expansion: OVERLAY_ONLY_EXPANSION,
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: req.prevQuestId,
    nextQuestId: null,
    rewardsJson: itemIds.length > 0 ? itemIds : null,
    objectives: null,
    classRestriction: req.classRestriction,
    raceRestriction: req.raceRestriction,
    startsInsideDungeon: INSIDE_DUNGEON_QUEST_IDS.has(row.questId),
    sharable: true,
    rewardXp: row.rewardXp,
    rewardGold: row.rewardMoneyCopper,
    rewardType: itemIds.length > 0 ? 'choice' : 'none',
  };
}

/** Merge each quest with its overlay row (if any). */
async function mergeQuests(
  db: QuestOverlayDeps['db'],
  quests: DungeonQuestDto[],
): Promise<DungeonQuestDto[]> {
  const overlay = await listBlizzardOverlay(
    db,
    quests.map((q) => q.questId),
  );
  return quests.map((q) => mergeBlizzardOverlay(q, overlay.get(q.questId)));
}

/**
 * Overlay rows mapped to these dungeons whose quest id is not in `known` and
 * whose type is a dungeon type (m5).
 */
async function listOverlayOnly(
  db: QuestOverlayDeps['db'],
  instanceIds: readonly number[],
  known: ReadonlySet<number>,
): Promise<DungeonQuestDto[]> {
  if (instanceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(wowDungeonQuestBlizzard)
    .where(
      inArray(wowDungeonQuestBlizzard.dungeonInstanceId, [...instanceIds]),
    );
  return rows
    .filter((row) => !known.has(row.questId) && isOverlayOnlyType(row.typeId))
    .sort((a, b) => a.questId - b.questId)
    .map(overlayOnlyDto);
}

/** Merge the overlay into quests (chain reads). Kill switch off → unchanged. */
export async function applyQuestOverlay(
  deps: QuestOverlayDeps,
  quests: DungeonQuestDto[],
): Promise<DungeonQuestDto[]> {
  if (quests.length === 0) return quests;
  if (!(await isForeverQuestImportEnabled(deps.settings))) return quests;
  return mergeQuests(deps.db, quests);
}

/**
 * A dungeon's quest list: merged curated rows, then overlay-only quests
 * (R4), which only a variant that includes classic content shows.
 */
export async function applyInstanceOverlay(
  deps: QuestOverlayDeps,
  quests: DungeonQuestDto[],
  scope: { instanceIds: readonly number[]; expansions: readonly string[] },
): Promise<DungeonQuestDto[]> {
  if (!(await isForeverQuestImportEnabled(deps.settings))) return quests;
  const merged = await mergeQuests(deps.db, quests);
  if (!scope.expansions.includes(OVERLAY_ONLY_EXPANSION)) return merged;
  const known = new Set(quests.map((q) => q.questId));
  const extras = await listOverlayOnly(deps.db, scope.instanceIds, known);
  return [...merged, ...extras];
}
