import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { GUILD_KINDS, type GuildKind } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

/**
 * ROK-1875 D8/D9 — which hubs `GET /hubs` may list for a viewer, per kind.
 * Membership for non-community kinds arrives as an id list from the hub-kind
 * adapters (core never imports plugin predicates — ROK-1733 boundary).
 */

const g = schema.guilds;

/** The viewer's own community-membership row (left-joined by the queries). */
export const viewerRow = alias(schema.hubCommunityMembers, 'viewer_row');

/** The viewer holds a live (not left, not banned) community membership. */
export const VIEWER_LIVE = sql`(${viewerRow.id} IS NOT NULL AND ${viewerRow.leftAt} IS NULL AND ${viewerRow.bannedAt} IS NULL)`;

/** What the directory may show this viewer. */
export interface DirectoryScope {
  /** Kinds to list (plugin-active, then narrowed by `?kind=`). */
  kinds: GuildKind[];
  /** Hub ids the viewer belongs to, unioned over every live adapter. */
  memberIds: number[];
  /** Admin / operator. */
  staff: boolean;
}

/** `guilds.id IN (...)`, or `false` for an empty list (never `IN ()`). */
function idIn(ids: number[]): SQL {
  return ids.length === 0 ? sql`false` : inArray(g.id, ids);
}

function kindBranch(kind: GuildKind, scope: DirectoryScope): SQL | undefined {
  const notHidden = isNull(g.hiddenAt);
  if (kind === 'game_community') {
    return and(eq(g.kind, kind), eq(g.status, 'active'), notHidden);
  }
  if (kind === 'game_server') return and(eq(g.kind, kind), notHidden);
  const gate = scope.staff ? undefined : idIn(scope.memberIds);
  return and(eq(g.kind, kind), notHidden, gate);
}

/** D8: the OR of each listed kind's visibility rule; `false` when none. */
export function visibleKinds(scope: DirectoryScope): SQL {
  const branches = scope.kinds.map((k) => kindBranch(k, scope));
  return or(...branches) ?? sql`false`;
}

/** "Joined": a live community row, or a non-community hub in `memberIds`. */
export function joinedPredicate(scope: DirectoryScope): SQL {
  const community = and(eq(g.kind, 'game_community'), VIEWER_LIVE);
  const other = and(ne(g.kind, 'game_community'), idIn(scope.memberIds));
  return or(community, other) ?? sql`false`;
}

/**
 * The page's `kinds` (every live kind, `GUILD_KINDS` order) and the kinds
 * actually queried (`?kind=` narrows; a dead kind narrows to nothing).
 */
export function directoryKinds(
  live: readonly GuildKind[],
  kind: GuildKind | undefined,
): { live: GuildKind[]; queried: GuildKind[] } {
  const ordered = GUILD_KINDS.filter((k) => live.includes(k));
  const queried = kind === undefined ? ordered : ordered.filter((k) => k === kind);
  return { live: ordered, queried };
}
