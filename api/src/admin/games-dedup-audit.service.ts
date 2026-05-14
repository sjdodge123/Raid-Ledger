/**
 * ROK-1271 / ROK-1277: GamesDedupAuditService.
 *
 * Read-only audit of duplicate `games` rows. Returns dup groups, per-loser
 * blast-radius counts (23 FK tables), and a summary. NO mutations — purely
 * SELECT queries.
 *
 * Algorithm:
 *   1. Load (id, name, slug, igdbId, itadGameId, steamAppId, cachedAt)
 *      from every row in `games`.
 *   2. (ROK-1277) Build connected components of rows joined by ANY shared
 *      key (igdb_id, steam_app_id, normalized name) via union-find.
 *   3. For each component with > 1 rows: pick canonical (itad → igdb → min
 *      id); everything else is a "dup id". `matchType` reports the strongest
 *      key actually shared inside the component (igdb > steam > name).
 *   4. For every dup id, run the 23-table blast-radius counter in parallel.
 *   5. Sort groups by total dups DESC, blast radius by total downstream DESC.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  computeBlastRadiusForId,
  pickCanonicalId,
  totalBlastRadius,
  type BlastRadiusCounts,
  type BlastRadiusRow,
  type GameRow,
} from './games-dedup-audit.helpers';
import { groupRowsByConnectedKeys } from './games-dedup-union-find.helpers';
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
    const connected = groupRowsByConnectedKeys(rows);
    const groups = buildGroups(connected);
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
   * group; downstream_counts is the per-key sum across the WHOLE group
   * (canonical + every dup), so the persisted value reflects total data
   * impact rather than dup-side-only repoint count (ROK-1278 fix —
   * dup-only undercounted real impact when canonical had its own rows).
   * Returns a compact summary with the top 10 groups by downstream rows.
   */
  async persistSnapshot(): Promise<PersistSummary> {
    const audit = await this.runAudit();
    const canonicalIds = audit.groups.map((g) => g.canonicalId);
    const canonicalBlast = await this.computeBlastRadius(canonicalIds);
    const blastByGameId = new Map<number, BlastRadiusRow>([
      ...audit.blastRadius.map((b) => [b.gameId, b] as const),
      ...canonicalBlast.map((b) => [b.gameId, b] as const),
    ]);
    const snapshotAt = new Date();

    const rows = await Promise.all(
      audit.groups.map(async (group) => {
        const downstreamCounts = sumBlastRadius(
          [group.canonicalId, ...group.dupIds].map(
            (id) => blastByGameId.get(id) ?? null,
          ),
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

function buildGroups(
  connectedGroups: Array<{
    rows: GameRow[];
    matchType: DedupMatchType;
    matchKey: string;
  }>,
): DedupGroup[] {
  const groups: DedupGroup[] = [];
  for (const { rows, matchType, matchKey } of connectedGroups) {
    if (rows.length < 2) continue;
    const canonicalId = pickCanonicalId(rows);
    const dupIds = rows
      .map((r) => r.id)
      .filter((id) => id !== canonicalId)
      .sort((a, b) => a - b);
    groups.push({ matchType, matchKey, canonicalId, dupIds });
  }
  return groups;
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


