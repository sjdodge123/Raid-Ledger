/**
 * One-time DB cleanup for duplicate game rows.
 * - ROK-1008: merges rows sharing the same steamAppId / igdbId.
 * - ROK-1113: merges rows sharing the same normalized canonical name
 *   (e.g., "Slay the Spire 2" vs "Slay the Spire II").
 *
 * Reassigns FK references to the winner row before deleting the losers.
 */
import { sql, eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  reassignEventFks,
  reassignLineupFks,
  reassignMiscFks,
} from './igdb-dedup-fk-reassign.helpers';
import {
  findDuplicateGroupsByNormalizedName,
  pickNameGroupWinner,
  type NameDuplicateGroup,
} from './igdb-name-dedup.helpers';

const nameDedupLogger = new Logger('IgdbNameDedupCleanup');

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
           array_agg(CASE WHEN ${g.itadGameId} IS NOT NULL THEN ${g.id} END) AS itad_ids,
           array_agg(CASE WHEN ${g.igdbId} IS NOT NULL THEN ${g.id} END) AS igdb_ids
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
           array_agg(CASE WHEN ${g.itadGameId} IS NOT NULL THEN ${g.id} END) AS itad_ids,
           array_agg(CASE WHEN ${g.igdbId} IS NOT NULL THEN ${g.id} END) AS igdb_ids
    FROM ${g}
    WHERE ${g.igdbId} IS NOT NULL
    GROUP BY ${g.igdbId}
    HAVING count(*) > 1
  `);
  return (rows as unknown as DupRow[]).map(buildGroupFromRow);
}

interface DupRow {
  key_val: number;
  ids: number[] | string;
  itad_ids: number[] | string;
  igdb_ids: number[] | string;
}

/** Parse a PostgreSQL array value (may be a string or already an array). */
function parsePgArray(val: number[] | string): number[] {
  if (Array.isArray(val)) {
    return val.filter((n): n is number => typeof n === 'number' && !isNaN(n));
  }
  if (typeof val !== 'string') return [];
  return val
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/** Build a DuplicateGroup from a raw DB row. */
function buildGroupFromRow(row: DupRow): DuplicateGroup {
  const ids = parsePgArray(row.ids);
  const itadIds = new Set(parsePgArray(row.itad_ids));
  const igdbIds = new Set(parsePgArray(row.igdb_ids));
  // Prefer game with both IGDB+ITAD, then IGDB only, then ITAD only
  const winnerId =
    ids.find((id) => igdbIds.has(id) && itadIds.has(id)) ??
    ids.find((id) => igdbIds.has(id)) ??
    ids.find((id) => itadIds.has(id)) ??
    ids[0];
  const loserIds = ids.filter((id) => id !== winnerId);
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

// ─── ROK-1113: normalized-name cleanup ──────────────────────────────────────

/** Per-group merge audit entry returned by the admin endpoint. */
export interface NameMergeReport {
  normalizedName: string;
  winnerId: number;
  loserIds: number[];
}

/** Result of a name-dedup cleanup run (commit mode). */
export interface NameDedupCommitResult {
  merged: number;
  errors: string[];
  report: NameMergeReport[];
  skippedGroups: NameDuplicateGroup[];
}

/** Result of a name-dedup cleanup run (dry-run mode). */
export interface NameDedupDryRunResult {
  totalGroups: number;
  totalLosers: number;
  groups: NameMergeReport[];
  skippedGroups: NameDuplicateGroup[];
}

/**
 * Compute a dry-run report: which rows would merge and which groups would be
 * skipped because of mixed igdbIds. Does not mutate the database.
 */
export async function dryRunNameDedup(
  db: PostgresJsDatabase<typeof schema>,
): Promise<NameDedupDryRunResult> {
  const { groups, skipped } = await findDuplicateGroupsByNormalizedName(db);
  const report = groups.map(buildMergeReport);
  const totalLosers = report.reduce((acc, g) => acc + g.loserIds.length, 0);
  return {
    totalGroups: groups.length,
    totalLosers,
    groups: report,
    skippedGroups: skipped,
  };
}

/**
 * Commit-mode cleanup: merges all eligible name-keyed duplicate groups, deleting
 * losers. Idempotent — a second run on a clean DB returns `{ merged: 0 }`.
 */
export async function mergeNameDuplicates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<NameDedupCommitResult> {
  const { groups, skipped } = await findDuplicateGroupsByNormalizedName(db);
  const report: NameMergeReport[] = [];
  const errors: string[] = [];

  for (const group of groups) {
    try {
      const entry = await mergeNameGroup(db, group);
      report.push(entry);
    } catch (err) {
      errors.push(`Group "${group.normalizedName}": ${err}`);
    }
  }

  return { merged: report.length, errors, report, skippedGroups: skipped };
}

/** Merge a single name-keyed group. Picks winner, reassigns FKs, deletes losers. */
async function mergeNameGroup(
  db: PostgresJsDatabase<typeof schema>,
  group: NameDuplicateGroup,
): Promise<NameMergeReport> {
  const winner = pickNameGroupWinner(group.rows);
  const loserIds = group.rows
    .filter((r) => r.id !== winner.id)
    .map((r) => r.id);

  await db.transaction(async (tx) => {
    for (const loserId of loserIds) {
      await reassignEventFks(tx, loserId, winner.id);
      await reassignLineupFks(tx, loserId, winner.id);
      await reassignMiscFks(tx, loserId, winner.id);
      await tx.delete(schema.games).where(eq(schema.games.id, loserId));
    }
  });

  nameDedupLogger.log(
    `Merged name group "${group.normalizedName}" — winner=${winner.id}, losers=[${loserIds.join(',')}]`,
  );
  return {
    normalizedName: group.normalizedName,
    winnerId: winner.id,
    loserIds,
  };
}

/** Build a winner/losers report for a name-keyed group (no DB writes). */
function buildMergeReport(group: NameDuplicateGroup): NameMergeReport {
  const winner = pickNameGroupWinner(group.rows);
  const loserIds = group.rows
    .filter((r) => r.id !== winner.id)
    .map((r) => r.id);
  return {
    normalizedName: group.normalizedName,
    winnerId: winner.id,
    loserIds,
  };
}
