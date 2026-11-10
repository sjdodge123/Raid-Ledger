/**
 * ROK-2143: the quest read path's Blizzard overlay. Curated rows (the bundled
 * JSON, re-seeded every boot) are merged field by field with the
 * `wow_dungeon_quest_blizzard` overlay, which the boot seeder never touches —
 * so imported values survive `seedQuests()`. R4 = include: an overlay row
 * mapped to the dungeon but missing from our JSON becomes its own quest.
 * With the `wow_forever_quest_import` kill switch off nothing here runs and
 * the curated rows come back unchanged (full rollback without a deploy).
 */
import { inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  wowDungeonQuestBlizzard,
  type WowDungeonQuestBlizzardRow,
} from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import { INSIDE_DUNGEON_QUEST_IDS } from './data/dungeon-quest-inside-allowlist';
import { MAX_CHAIN_DEPTH } from './dungeon-quests.helpers';
import { listBlizzardOverlay } from './forever-quest-import/blizzard-quest.repo';
import {
  mergeBlizzardOverlay,
  reputationRewardFields,
} from './forever-quest-import/blizzard-quest-overlay.merge';
import { requirementFields } from './forever-quest-import/blizzard-quest.requirements';
import { isForeverQuestImportEnabled } from './forever-quest-import/forever-quest-import-switch';
import type { DungeonQuestDto } from './dungeon-quests.types';

/** What the overlay reads: the DB and the kill-switch setting. */
export interface QuestOverlayDeps {
  db: PostgresJsDatabase<typeof schema>;
  settings: Pick<SettingsService, 'get'>;
}

const t = wowDungeonQuestBlizzard;

/**
 * The overlay columns the read path needs — never `raw` (the whole Blizzard
 * response), which a progress/readiness request would fetch and discard.
 */
const OVERLAY_COLUMNS = {
  questId: t.questId,
  dungeonInstanceId: t.dungeonInstanceId,
  title: t.title,
  typeId: t.typeId,
  rewardXp: t.rewardXp,
  rewardMoneyCopper: t.rewardMoneyCopper,
  rewardItems: t.rewardItems,
  reputations: t.reputations,
  requirementsRaw: t.requirementsRaw,
};

/** An overlay row as the read path selects it ({@link OVERLAY_COLUMNS}). */
export type OverlayQuestRow = Pick<
  WowDungeonQuestBlizzardRow,
  keyof typeof OVERLAY_COLUMNS
>;

/** Overlay rows matching `where`, read-path columns only. */
function selectOverlayRows(
  db: QuestOverlayDeps['db'],
  where: SQL | undefined,
): Promise<OverlayQuestRow[]> {
  return db.select(OVERLAY_COLUMNS).from(t).where(where);
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
export function overlayOnlyDto(row: OverlayQuestRow): DungeonQuestDto {
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
    ...reputationRewardFields(row.reputations),
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
  const where = inArray(t.dungeonInstanceId, [...instanceIds]);
  return toOverlayOnlyDtos(await selectOverlayRows(db, where), known);
}

/** Rows not in `known` whose type is a dungeon type (m5), as quest DTOs. */
function toOverlayOnlyDtos(
  rows: readonly OverlayQuestRow[],
  known: ReadonlySet<number>,
): DungeonQuestDto[] {
  return rows
    .filter((row) => !known.has(row.questId) && isOverlayOnlyType(row.typeId))
    .sort((a, b) => a.questId - b.questId)
    .map(overlayOnlyDto);
}

/**
 * One read for {@link applyKnownQuestOverlay}: every row mapped to a dungeon
 * (overlay-only cards) plus the rows of `questIds` (the merge — a curated
 * quest's overlay row may have no dungeon).
 */
function listKnownOverlay(
  db: QuestOverlayDeps['db'],
  questIds: readonly number[],
): Promise<OverlayQuestRow[]> {
  const mapped = isNotNull(t.dungeonInstanceId);
  const where =
    questIds.length > 0
      ? or(mapped, inArray(t.questId, [...questIds]))
      : mapped;
  return selectOverlayRows(db, where);
}

/** Distinct prerequisite ids of `quests` not yet in `seen`. */
function unseenPrereqs(
  quests: readonly DungeonQuestDto[],
  seen: ReadonlySet<number>,
): number[] {
  const ids = quests.flatMap((q) =>
    q.prevQuestId !== null && !seen.has(q.prevQuestId) ? [q.prevQuestId] : [],
  );
  return [...new Set(ids)];
}

/** Overlay rows for `ids`: from `byId` when already read, else one query. */
async function overlayRowsById(
  db: QuestOverlayDeps['db'],
  ids: readonly number[],
  byId: ReadonlyMap<number, OverlayQuestRow>,
): Promise<OverlayQuestRow[]> {
  const cached = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length === 0) return cached;
  return [
    ...cached,
    ...(await selectOverlayRows(db, inArray(t.questId, missing))),
  ];
}

/**
 * Codex P2: overlay-only prerequisites of `quests`, any type and any dungeon
 * (like {@link applyChainOverlay}), walked at most {@link MAX_CHAIN_DEPTH}
 * links. They resolve prerequisites only — `dungeonInstanceId` is cleared so
 * one is never an event quest or a character-page card (the R4 type gate
 * decides cards).
 */
async function resolveOverlayPrereqs(
  db: QuestOverlayDeps['db'],
  quests: readonly DungeonQuestDto[],
  byId: ReadonlyMap<number, OverlayQuestRow>,
): Promise<DungeonQuestDto[]> {
  const seen = new Set(quests.map((q) => q.questId));
  const found: DungeonQuestDto[] = [];
  let frontier = unseenPrereqs(quests, seen);
  for (let d = 0; frontier.length > 0 && d < MAX_CHAIN_DEPTH; d++) {
    for (const id of frontier) seen.add(id);
    const rows = await overlayRowsById(db, frontier, byId);
    const dtos = rows.map((row) => ({
      ...overlayOnlyDto(row),
      dungeonInstanceId: null,
    }));
    found.push(...dtos);
    frontier = unseenPrereqs(dtos, seen);
  }
  return found;
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

/**
 * Chain links (Codex P2): the bundled rows for `requestedIds`, merged with
 * the overlay, plus an overlay-only row for every requested id our JSON
 * lacks — a prerequisite Blizzard imported with no dungeon still joins the
 * chain. No type filter: a prerequisite need not be a dungeon quest. Kill
 * switch off → the bundled rows unchanged.
 */
export async function applyChainOverlay(
  deps: QuestOverlayDeps,
  bundled: DungeonQuestDto[],
  requestedIds: readonly number[],
): Promise<DungeonQuestDto[]> {
  if (requestedIds.length === 0) return bundled;
  if (!(await isForeverQuestImportEnabled(deps.settings))) return bundled;
  const overlay = await listBlizzardOverlay(deps.db, requestedIds);
  const merged = bundled.map((q) =>
    mergeBlizzardOverlay(q, overlay.get(q.questId)),
  );
  const known = new Set(bundled.map((q) => q.questId));
  const extras = [...new Set(requestedIds)]
    .filter((id) => !known.has(id))
    .flatMap((id) => {
      const row = overlay.get(id);
      return row ? [overlayOnlyDto(row)] : [];
    });
  return [...merged, ...extras];
}

/**
 * Codex P2 3: the Forever known-quest set (event quest sets, progress,
 * coverage, readiness, the character page). Curated rows merged with the
 * overlay, plus every dungeon-type overlay-only quest mapped to any dungeon
 * (R4) — the same quests the Quest Prep cards show, so they get completion
 * state too — plus the overlay-only prerequisites those quests name, so
 * `prereqsMet` sees them. Kill switch off → the curated rows unchanged.
 */
export async function applyKnownQuestOverlay(
  deps: QuestOverlayDeps,
  quests: DungeonQuestDto[],
): Promise<DungeonQuestDto[]> {
  if (!(await isForeverQuestImportEnabled(deps.settings))) return quests;
  const rows = await listKnownOverlay(
    deps.db,
    quests.map((q) => q.questId),
  );
  const byId = new Map(rows.map((row) => [row.questId, row]));
  const known = new Set(quests.map((q) => q.questId));
  const mapped = rows.filter((row) => row.dungeonInstanceId !== null);
  const withCards = [
    ...quests.map((q) => mergeBlizzardOverlay(q, byId.get(q.questId))),
    ...toOverlayOnlyDtos(mapped, known),
  ];
  const prereqs = await resolveOverlayPrereqs(deps.db, withCards, byId);
  return [...withCards, ...prereqs];
}
