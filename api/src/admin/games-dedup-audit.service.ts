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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  bucketRowsByDedupKey,
  computeBlastRadiusForId,
  pickCanonicalId,
  totalBlastRadius,
  type BlastRadiusRow,
  type DedupKey,
  type GameRow,
} from './games-dedup-audit.helpers';

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
  return b.dupIds.length + 1 - (a.dupIds.length + 1);
}

function compareBlastRadius(a: BlastRadiusRow, b: BlastRadiusRow): number {
  return totalBlastRadius(b) - totalBlastRadius(a);
}
