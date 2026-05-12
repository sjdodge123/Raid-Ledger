/**
 * ROK-1271: GamesDedupAuditService.
 *
 * Phase 0 of ROK-1270: read-only audit of duplicate `games` rows.
 * Returns dup groups, per-loser blast-radius counts (17 FK tables), and
 * a summary. NO mutations — purely SELECT queries.
 *
 * Algorithm:
 *   1. Load (id, name, slug, igdbId, itadGameId, steamAppId, cachedAt)
 *      from every row in `games`.
 *   2. Bucket rows by precedence key: igdb → steam → name.
 *   3. For each bucket with > 1 rows: pick canonical (itad → igdb → min id),
 *      everything else is a "dup id".
 *   4. For every dup id, run the 17-table blast-radius counter in parallel.
 *   5. Sort groups by total dups DESC, blast radius by total downstream DESC.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  bucketRowsByDedupKey,
  computeBlastRadiusForId,
  pickCanonicalId,
  totalBlastRadius,
  type BlastRadiusCounts,
  type BlastRadiusRow,
  type DedupKey,
  type GameRow,
} from './games-dedup-audit.helpers';
import {
  computeUniqueConflicts,
  type UniqueConflictCounts,
} from './games-dedup-unique-conflicts.helpers';

export type DedupMatchType = 'igdb' | 'steam' | 'name';

export interface DedupGroup {
  matchType: DedupMatchType;
  matchKey: string;
  canonicalId: number;
  dupIds: number[];
}

export interface DedupAuditSummary {
  totalGames: number;
  totalGroups: number;
  totalDupRows: number;
}

export interface DedupAuditResponse {
  summary: DedupAuditSummary;
  groups: DedupGroup[];
  blastRadius: BlastRadiusRow[];
}

export interface PersistSummaryTopGroup {
  canonicalGameId: number;
  matchType: DedupMatchType;
  dupCount: number;
  downstreamRowCount: number;
  uniqueConflictCount: number;
}

export interface PersistSummary {
  snapshotAt: string;
  totalGames: number;
  totalGroups: number;
  totalDupRows: number;
  byStrategy: { igdb: number; steam: number; name: number };
  topGroups: PersistSummaryTopGroup[];
}

const ZERO_BLAST_RADIUS: BlastRadiusCounts = {
  events: 0,
  eventPlans: 0,
  lineupsDecided: 0,
  lineupEntries: 0,
  lineupMatches: 0,
  lineupMatchMembers: 0,
  tiebreakers: 0,
  characters: 0,
  tasteVectors: 0,
  interests: 0,
  activityRollups: 0,
  activitySessions: 0,
  availability: 0,
  channelBindings: 0,
  discordMappings: 0,
  eventTypes: 0,
  interestSuppressions: 0,
  tiebreakerBracketGameA: 0,
  tiebreakerBracketGameB: 0,
  tiebreakerBracketWinner: 0,
  tiebreakerBracketVotes: 0,
  tiebreakerVetoes: 0,
  playerIntensitySnapshots: 0,
};

@Injectable()
export class GamesDedupAuditService {
  private readonly logger = new Logger(GamesDedupAuditService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async runAudit(): Promise<DedupAuditResponse> {
    const rows = await this.loadGameRows();
    const buckets = bucketRowsByDedupKey(rows);
    const groups = buildGroups(buckets);
    const dupIds = groups.flatMap((g) => g.dupIds);
    this.logger.log(
      `dedup-audit: ${rows.length} games, ${groups.length} groups, ${dupIds.length} dup rows`,
    );
    const blastRadius = await this.computeBlastRadius(dupIds);
    return {
      summary: {
        totalGames: rows.length,
        totalGroups: groups.length,
        totalDupRows: dupIds.length,
      },
      groups: groups.sort(compareGroups),
      blastRadius: blastRadius.sort(compareBlastRadius),
    };
  }

  /**
   * ROK-1270: same audit as `runAudit()`, but TRUNCATE+INSERT the result
   * into `games_dedup_audit` in a single transaction. One row per dup
   * group; downstream_counts is the per-key sum across the group's dupIds.
   * Returns a compact summary with the top 10 groups by downstream rows.
   */
  async persistSnapshot(): Promise<PersistSummary> {
    const audit = await this.runAudit();
    const blastByGameId = new Map<number, BlastRadiusRow>(
      audit.blastRadius.map((b) => [b.gameId, b]),
    );
    const snapshotAt = new Date();

    const rows = await Promise.all(
      audit.groups.map(async (group) => {
        const downstreamCounts = sumBlastRadius(
          group.dupIds.map((id) => blastByGameId.get(id) ?? null),
        );
        const uniqueConflicts = await computeUniqueConflicts(this.db, {
          canonicalId: group.canonicalId,
          dupIds: group.dupIds,
        });
        return {
          matchType: group.matchType,
          matchKey: group.matchKey,
          canonicalGameId: group.canonicalId,
          dupGameIds: group.dupIds,
          groupSize: group.dupIds.length + 1,
          downstreamCounts,
          uniqueConflicts,
          snapshotAt,
        };
      }),
    );

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`TRUNCATE TABLE games_dedup_audit RESTART IDENTITY`);
      if (rows.length > 0) {
        await tx.insert(schema.gamesDedupAudit).values(rows);
      }
    });

    return buildPersistSummary(audit, rows, snapshotAt);
  }

  private async loadGameRows(): Promise<GameRow[]> {
    return this.db
      .select({
        id: schema.games.id,
        name: schema.games.name,
        slug: schema.games.slug,
        igdbId: schema.games.igdbId,
        itadGameId: schema.games.itadGameId,
        steamAppId: schema.games.steamAppId,
        cachedAt: schema.games.cachedAt,
      })
      .from(schema.games);
  }

  private async computeBlastRadius(
    dupIds: number[],
  ): Promise<BlastRadiusRow[]> {
    if (dupIds.length === 0) return [];
    return Promise.all(
      dupIds.map((id) => computeBlastRadiusForId(this.db, id)),
    );
  }
}

function buildGroups(buckets: Map<DedupKey, GameRow[]>): DedupGroup[] {
  const groups: DedupGroup[] = [];
  for (const [key, rows] of buckets.entries()) {
    if (rows.length < 2) continue;
    const canonicalId = pickCanonicalId(rows);
    const dupIds = rows
      .map((r) => r.id)
      .filter((id) => id !== canonicalId)
      .sort((a, b) => a - b);
    const { matchType, matchKey } = parseKey(key);
    groups.push({ matchType, matchKey, canonicalId, dupIds });
  }
  return groups;
}

function parseKey(key: DedupKey): {
  matchType: DedupMatchType;
  matchKey: string;
} {
  if (key.startsWith('igdb:'))
    return { matchType: 'igdb', matchKey: key.slice(5) };
  if (key.startsWith('steam:'))
    return { matchType: 'steam', matchKey: key.slice(6) };
  return { matchType: 'name', matchKey: key.slice(5) };
}

function compareGroups(a: DedupGroup, b: DedupGroup): number {
  const aDups = a.dupIds.length;
  const bDups = b.dupIds.length;
  if (aDups !== bDups) return bDups - aDups;
  return a.canonicalId - b.canonicalId;
}

function compareBlastRadius(a: BlastRadiusRow, b: BlastRadiusRow): number {
  return totalBlastRadius(b) - totalBlastRadius(a);
}

/** Sum each FK key across a group's dup-id blast-radius rows (zero-fill missing). */
function sumBlastRadius(rows: Array<BlastRadiusRow | null>): BlastRadiusCounts {
  const acc: BlastRadiusCounts = { ...ZERO_BLAST_RADIUS };
  for (const row of rows) {
    if (!row) continue;
    for (const key of Object.keys(ZERO_BLAST_RADIUS) as Array<
      keyof BlastRadiusCounts
    >) {
      acc[key] += row[key];
    }
  }
  return acc;
}

interface PersistedRow {
  matchType: DedupMatchType;
  matchKey: string;
  canonicalGameId: number;
  dupGameIds: number[];
  groupSize: number;
  downstreamCounts: BlastRadiusCounts;
  uniqueConflicts: UniqueConflictCounts;
  snapshotAt: Date;
}

function sumUniqueConflicts(uc: UniqueConflictCounts): number {
  return Object.values(uc).reduce((a, b) => a + b, 0);
}

function buildPersistSummary(
  audit: DedupAuditResponse,
  rows: PersistedRow[],
  snapshotAt: Date,
): PersistSummary {
  const byStrategy = { igdb: 0, steam: 0, name: 0 };
  for (const group of audit.groups) byStrategy[group.matchType] += 1;

  const topGroups: PersistSummaryTopGroup[] = rows
    .map((r) => ({
      canonicalGameId: r.canonicalGameId,
      matchType: r.matchType,
      dupCount: r.dupGameIds.length,
      downstreamRowCount: totalBlastRadius(r.downstreamCounts),
      uniqueConflictCount: sumUniqueConflicts(r.uniqueConflicts),
    }))
    .sort((a, b) => {
      if (a.downstreamRowCount !== b.downstreamRowCount) {
        return b.downstreamRowCount - a.downstreamRowCount;
      }
      return b.dupCount - a.dupCount;
    })
    .slice(0, 10);

  return {
    snapshotAt: snapshotAt.toISOString(),
    totalGames: audit.summary.totalGames,
    totalGroups: audit.summary.totalGroups,
    totalDupRows: audit.summary.totalDupRows,
    byStrategy,
    topGroups,
  };
}
