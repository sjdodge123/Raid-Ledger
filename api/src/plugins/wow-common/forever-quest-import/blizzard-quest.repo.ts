/**
 * ROK-2143: read/write helpers for the `wow_dungeon_quest_blizzard` overlay.
 * Upserts are keyed on `quest_id`: a re-run replaces every value plus
 * `fetched_at` and `run_id`. Rows a later run did not touch are kept and
 * surface through `listStaleQuestIds`. One statement per chunk — no
 * catch-and-retry.
 */
import { asc, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import {
  wowDungeonQuestBlizzard,
  type WowDungeonQuestBlizzardInsert,
  type WowDungeonQuestBlizzardRow,
} from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Rows per INSERT; 13 columns × 500 stays far under Postgres' 65535 params. */
export const BLIZZARD_QUEST_UPSERT_CHUNK = 500;

const t = wowDungeonQuestBlizzard;

/** `excluded.<column>` — take the incoming value on conflict. */
function excluded(col: PgColumn): SQL {
  return sql`excluded.${sql.identifier(col.name)}`;
}

/** Every non-key column replaced by the incoming row on conflict. */
export function blizzardQuestConflictSet(): Record<string, SQL> {
  return {
    areaId: excluded(t.areaId),
    dungeonInstanceId: excluded(t.dungeonInstanceId),
    title: excluded(t.title),
    typeId: excluded(t.typeId),
    rewardXp: excluded(t.rewardXp),
    rewardMoneyCopper: excluded(t.rewardMoneyCopper),
    rewardItems: excluded(t.rewardItems),
    reputations: excluded(t.reputations),
    requirementsRaw: excluded(t.requirementsRaw),
    raw: excluded(t.raw),
    fetchedAt: excluded(t.fetchedAt),
    runId: excluded(t.runId),
  };
}

/** Last write wins inside one call, so a chunk never names a quest twice. */
function dedupeByQuestId(
  rows: readonly WowDungeonQuestBlizzardInsert[],
): WowDungeonQuestBlizzardInsert[] {
  const byId = new Map<number, WowDungeonQuestBlizzardInsert>();
  for (const row of rows) byId.set(row.questId, row);
  return [...byId.values()];
}

/** Insert or replace overlay rows by `quest_id`. Returns rows written. */
export async function upsertBlizzardQuests(
  db: Db,
  rows: readonly WowDungeonQuestBlizzardInsert[],
): Promise<number> {
  const unique = dedupeByQuestId(rows);
  for (let i = 0; i < unique.length; i += BLIZZARD_QUEST_UPSERT_CHUNK) {
    const chunk = unique.slice(i, i + BLIZZARD_QUEST_UPSERT_CHUNK);
    await db
      .insert(t)
      .values(chunk)
      .onConflictDoUpdate({
        target: t.questId,
        set: blizzardQuestConflictSet(),
      });
  }
  return unique.length;
}

/**
 * Overlay rows keyed by quest id. No `questIds` = the whole table; an empty
 * list = an empty map without a query.
 */
export async function listBlizzardOverlay(
  db: Db,
  questIds?: readonly number[],
): Promise<Map<number, WowDungeonQuestBlizzardRow>> {
  if (questIds !== undefined && questIds.length === 0) return new Map();
  const base = db.select().from(t);
  const rows =
    questIds === undefined
      ? await base
      : await base.where(inArray(t.questId, [...new Set(questIds)]));
  return new Map(rows.map((row) => [row.questId, row]));
}

/** Quest ids the run `runId` did not write (kept, but reported stale). */
export async function listStaleQuestIds(
  db: Db,
  runId: string,
): Promise<number[]> {
  const rows = await db
    .select({ questId: t.questId })
    .from(t)
    .where(ne(t.runId, runId))
    .orderBy(asc(t.questId));
  return rows.map((row) => row.questId);
}
