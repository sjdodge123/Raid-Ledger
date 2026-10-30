import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type * as schema from '../../../../drizzle/schema';
import type { HubKindAdapter } from '../../../plugin-host/extension-points';
import { dedupeByMember, loadRosterRows } from '../guild-roster.helpers';
import { loadCommunityRosterRows } from './roster-insights.community';
import { computeFreshness, computeRoles } from './roster-insights.helpers';
import { computeClasses, computeLevels } from './roster-insights.levels';
import type { ResolvedWowFacts } from '../../facts/wow-fact.types';
import type { InsightRow } from './roster-insights.types';

/**
 * ROK-1925 (D1/D2) — roster refs per hub kind. `wow_guild`: the latest
 * snapshot's `guild_members` rows (one per member), keyed `m<memberId>`.
 * `game_community`: the live members' Forever characters, keyed
 * `c<characterId>` with `memberId: null` and no rank/presence. Any other kind
 * has no roster.
 */

type Db = PostgresJsDatabase<typeof schema>;

/** A roster row before facts: identity plus its resolver key. */
export interface InsightRawRow extends Omit<InsightRow, 'facts'> {
  key: string;
  memberId: number | null;
}

/** The hub's roster rows, picked by the hub kind's adapter. */
export async function loadInsightRawRows(
  db: Db,
  adapter: Pick<HubKindAdapter, 'kind' | 'memberUserIds'> | undefined,
  guildId: number,
): Promise<InsightRawRow[]> {
  if (adapter?.kind === 'wow_guild') return loadGuildRows(db, guildId);
  if (adapter?.kind === 'game_community') {
    const userIds = await adapter.memberUserIds(guildId);
    return loadCommunityRows(db, guildId, userIds);
  }
  return [];
}

async function loadGuildRows(
  db: Db,
  guildId: number,
): Promise<InsightRawRow[]> {
  const rows = dedupeByMember(await loadRosterRows(db, guildId));
  return rows.map((r) => ({
    key: `m${r.memberId}`,
    memberId: r.memberId,
    name: r.name,
    characterId: r.characterId,
    userId: r.userId,
    isMain: r.isMain ?? false,
    rankIndex: r.rankIndex,
    onlineAtExport: r.onlineAtExport,
    lastOnlineDays: r.lastOnlineDays,
  }));
}

/**
 * ROK-1917 Q1 — the linked users of a `wow_guild` hub's roster: the same rows
 * (and owner links) the insight's `linkedUserIds` come from. The raid import
 * uses it to decide who may claim a duplicate pull (Codex P2).
 */
export async function loadGuildLinkedUserIds(
  db: Db,
  guildId: number,
): Promise<number[]> {
  const rows = await loadGuildRows(db, guildId);
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
}

async function loadCommunityRows(
  db: Db,
  hubId: number,
  userIds: readonly number[],
): Promise<InsightRawRow[]> {
  const rows = await loadCommunityRosterRows(db, hubId, userIds);
  return rows.map((r) => ({
    key: `c${r.characterId}`,
    memberId: null,
    name: r.name,
    characterId: r.characterId,
    userId: r.userId,
    isMain: r.isMain,
    rankIndex: null,
    onlineAtExport: null,
    lastOnlineDays: null,
  }));
}

/** A raw row plus its resolved facts (the resolver key is dropped). */
export function toInsightRow(
  r: InsightRawRow,
  facts: ResolvedWowFacts,
): InsightRow {
  return {
    name: r.name,
    characterId: r.characterId,
    userId: r.userId,
    isMain: r.isMain,
    rankIndex: r.rankIndex,
    onlineAtExport: r.onlineAtExport,
    lastOnlineDays: r.lastOnlineDays,
    facts,
  };
}

/** The roster with facts, plus the owners of its linked characters. */
export interface JoinedRoster {
  /** Rows with resolved facts; rows past the resolver cap have none and drop. */
  rows: InsightRow[];
  /**
   * ROK-1917 Q1 — every linked character's owner, from the RAW rows, so a
   * member past the resolver cap still counts as a trusted pull reporter.
   */
  linkedUserIds: number[];
}

/** Join raw rows to their resolved facts (by resolver key). */
export function joinFacts(
  raw: readonly InsightRawRow[],
  facts: { get(key: string): ResolvedWowFacts | undefined },
): JoinedRoster {
  return {
    rows: raw.flatMap((r) => {
      const resolved = facts.get(r.key);
      return resolved ? [toInsightRow(r, resolved)] : [];
    }),
    linkedUserIds: raw.flatMap((r) => (r.userId === null ? [] : [r.userId])),
  };
}

/**
 * ROK-1925 Q1 = A — a community hub visitor's payload: empty breakdowns, no
 * member-only keys, so no member name or character id can leak (and the
 * widgets hide on empty data).
 */
export function emptyInsights(): WowRosterInsightsDto {
  return {
    classes: computeClasses([]),
    levels: computeLevels([]),
    roles: computeRoles([]),
    freshness: computeFreshness([]),
  };
}
