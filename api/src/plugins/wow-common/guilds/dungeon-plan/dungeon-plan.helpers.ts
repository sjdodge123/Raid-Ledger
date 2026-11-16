/**
 * ROK-2214 — pure steps of the dungeon plan read (no DB): the hub check, the
 * level fit, the side the quest list is filtered to, that filter, and which
 * requested characters are kept. The service composes them around the event
 * readiness builder (`buildQuestReadiness`), passing the plan side as its override.
 */
import type { DungeonLevelFit } from '@raid-ledger/contract';
import type { ForeverEventProgress } from '../../event-forever-progress.helpers';
import type { ReadinessSignup } from '../../event-quest-readiness.helpers';
import {
  characterSide,
  factionOfColumn,
  isQuestUsableBySide,
  sharedSide,
  type FactionSide,
} from '../../quest-faction.helpers';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';

/** The hub fields the planner check reads. */
export interface PlanHubRef {
  kind: string;
  gameSlug: string | null;
}

/** The quest set the readiness builder takes (`loadEventQuestSet`'s result). */
export type PlanQuestSet = Pick<
  ForeverEventProgress,
  'eventQuests' | 'lookup' | 'knownIds'
>;

/** The side the plan's quests are filtered to, and where it came from. */
export interface PlanSide {
  side: FactionSide | null;
  sideSource: 'guild' | 'characters' | null;
}

/** A roster row as `pickRosterCharacters` reads it. */
export interface PlanRosterRow {
  characterId: string | null;
  userId: number | null;
}

/** L3: the planner exists only on a WoW: Forever `wow_guild` hub. */
export function isPlannerHub(hub: PlanHubRef | null): boolean {
  return hub?.kind === 'wow_guild' && hub.gameSlug === WOW_FOREVER_GAME_SLUG;
}

/** L9: a level against the dungeon's range, bounds inclusive. */
export function levelFit(
  level: number | null,
  minimumLevel: number,
  maximumLevel: number,
): DungeonLevelFit {
  if (level === null) return 'unknown';
  if (level < minimumLevel) return 'below';
  if (level > maximumLevel) return 'above';
  return 'in';
}

/**
 * L7: the guild's faction column wins; else the side every kept character
 * shares (race first, then the stored column); else no side.
 */
export function resolvePlanSide(
  guildFaction: string | null,
  chars: readonly Pick<ReadinessSignup, 'charRace' | 'charFaction'>[],
): PlanSide {
  const guildSide = factionOfColumn(guildFaction);
  if (guildSide !== null) return { side: guildSide, sideSource: 'guild' };
  const shared = sharedSide(
    chars.map((c) => characterSide(c.charRace, c.charFaction)),
  );
  if (shared !== null) return { side: shared, sideSource: 'characters' };
  return { side: null, sideSource: null };
}

/**
 * L7: drop the quests only the other side can take (neutral and unknown-race
 * quests stay). `lookup`/`knownIds` are kept whole so chain walks still see
 * every quest. `hidden` counts distinct removed quests the readiness matrix
 * would have shown (non-null `dungeonInstanceId`).
 */
export function filterQuestSetBySide(
  questSet: PlanQuestSet,
  side: FactionSide | null,
): { questSet: PlanQuestSet; hidden: number } {
  const removed = new Set<number>();
  const eventQuests = questSet.eventQuests.filter((q) => {
    if (isQuestUsableBySide(q, side)) return true;
    if (q.dungeonInstanceId !== null) removed.add(q.questId);
    return false;
  });
  return { questSet: { ...questSet, eventQuests }, hidden: removed.size };
}

/**
 * L5/L6: the requested ids that are CLAIMED characters on this roster, as
 * their rows in request order (duplicates keep the first); every other id is
 * echoed once in `dropped`.
 */
export function pickRosterCharacters<T extends PlanRosterRow>(
  rows: readonly T[],
  ids: readonly string[],
): { kept: T[]; dropped: string[] } {
  const claimed = new Map<string, T>();
  for (const row of rows) {
    if (row.characterId === null || row.userId === null) continue;
    if (!claimed.has(row.characterId)) claimed.set(row.characterId, row);
  }
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const id of new Set(ids)) {
    const row = claimed.get(id);
    if (row === undefined) dropped.push(id);
    else kept.push(row);
  }
  return { kept, dropped };
}
