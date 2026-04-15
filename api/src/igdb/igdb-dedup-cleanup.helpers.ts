/**
 * One-time DB cleanup for duplicate game rows (ROK-1008).
 * Finds games sharing the same steamAppId or igdbId and merges them,
 * reassigning FK references to the winner row.
 */
import { sql, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  reassignEventFks,
  reassignLineupFks,
  reassignMiscFks,
} from './igdb-dedup-fk-reassign.helpers';

/** A group of duplicate games with a designated winner and losers. */
export interface DuplicateGroup {
  winnerId: number;
  loserIds: number[];
}

/** Find duplicate game rows grouped by steamAppId or igdbId. */
export async function findDuplicateGames(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DuplicateGroup[]> {
  const steamDups = await findDupsBySteamAppId(db);
  const igdbDups = await findDupsByIgdbId(db);
  return deduplicateGroups([...steamDups, ...igdbDups]);
}

/** Merge and delete duplicate game rows in a transaction. */
export async function mergeAndDeleteDuplicates(
  db: PostgresJsDatabase<typeof schema>,
  groups: DuplicateGroup[],
): Promise<{ merged: number; errors: string[] }> {
  let merged = 0;
  const errors: string[] = [];

  for (const group of groups) {
    try {
      await mergeGroup(db, group);
      merged++;
    } catch (err) {
      errors.push(`Group winner=${group.winnerId}: ${err}`);
    }
  }

  return { merged, errors };
}

/** Find duplicates by steamAppId. */
async function findDupsBySteamAppId(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DuplicateGroup[]> {
  const g = schema.games;
  const rows = await db.execute(sql`
    SELECT ${g.steamAppId} AS key_val, array_agg(${g.id}) AS ids,
           array_agg(CASE WHEN ${g.itadGameId} IS NOT NULL THEN ${g.id} END) AS itad_ids
    FROM ${g}
    WHERE ${g.steamAppId} IS NOT NULL
    GROUP BY ${g.steamAppId}
    HAVING count(*) > 1
  `);
  return (rows as unknown as DupRow[]).map(buildGroupFromRow);
}

/** Find duplicates by igdbId. */
async function findDupsByIgdbId(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DuplicateGroup[]> {
  const g = schema.games;
  const rows = await db.execute(sql`
    SELECT ${g.igdbId} AS key_val, array_agg(${g.id}) AS ids,
           array_agg(CASE WHEN ${g.itadGameId} IS NOT NULL THEN ${g.id} END) AS itad_ids
    FROM ${g}
    WHERE ${g.igdbId} IS NOT NULL
    GROUP BY ${g.igdbId}
    HAVING count(*) > 1
  `);
  return (rows as unknown as DupRow[]).map(buildGroupFromRow);
}

interface DupRow {
  key_val: number;
  ids: number[];
  itad_ids: (number | null)[];
}

/** Build a DuplicateGroup from a raw DB row. */
function buildGroupFromRow(row: DupRow): DuplicateGroup {
  const itadId = row.itad_ids.find((id) => id != null);
  const winnerId = itadId ?? row.ids[0];
  const loserIds = row.ids.filter((id) => id !== winnerId);
  return { winnerId, loserIds };
}

/** Deduplicate groups that may share the same winner. */
function deduplicateGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
  const byWinner = new Map<number, Set<number>>();
  for (const g of groups) {
    const existing = byWinner.get(g.winnerId) ?? new Set<number>();
    for (const id of g.loserIds) existing.add(id);
    byWinner.set(g.winnerId, existing);
  }
  return Array.from(byWinner.entries()).map(([winnerId, loserSet]) => ({
    winnerId,
    loserIds: [...loserSet],
  }));
}

/** Merge a single duplicate group: reassign FKs and delete losers. */
async function mergeGroup(
  db: PostgresJsDatabase<typeof schema>,
  group: DuplicateGroup,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const loserId of group.loserIds) {
      await reassignEventFks(tx, loserId, group.winnerId);
      await reassignLineupFks(tx, loserId, group.winnerId);
      await reassignMiscFks(tx, loserId, group.winnerId);
      await tx.delete(schema.games).where(eq(schema.games.id, loserId));
    }
  });
}
