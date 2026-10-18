import type {
  GuildServerArrival,
  GuildMemberRow,
  GuildPage,
  GuildPageServer,
  GuildSummary,
  LadderRole,
} from '@raid-ledger/contract';
import { viewerAccess } from '../../../guilds/guild-access.service';

/** One live member of a server hub, as loaded for the page. */
export interface ServerMemberRecord {
  memberId: number;
  userId: number;
  name: string;
  steamId: string | null;
  source: 'presence' | 'manual';
  lastSeenAt: Date | null;
  joinedAt: Date | null;
  leftAt: Date | null;
  characterName: string | null;
  firstSeenAt: Date | null;
}

/** How many arrivals the Overview widget lists (contract max). */
export const RECENT_ARRIVALS_LIMIT = 5;

/** A member row with the game-server columns; every WoW column is null. */
export function toServerMemberRow(
  r: ServerMemberRecord,
  onlineNow: boolean,
): GuildMemberRow {
  return {
    memberId: r.memberId,
    name: r.name,
    class: null,
    level: null,
    rankIndex: null,
    rankName: null,
    effectiveRole: null,
    characterId: null,
    isMain: false,
    server: {
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      onlineNow,
      characterName: r.characterName,
      source: r.source,
      firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
    },
  };
}

/** Online first, then most recently seen (never seen last), then name. */
export function orderServerMembers(rows: GuildMemberRow[]): GuildMemberRow[] {
  const seen = (r: GuildMemberRow): string => r.server?.lastSeenAt ?? '';
  return [...rows].sort((a, b) => {
    const online = Number(b.server?.onlineNow) - Number(a.server?.onlineNow);
    if (online !== 0) return online;
    const bySeen = seen(b).localeCompare(seen(a));
    return bySeen !== 0 ? bySeen : a.name.localeCompare(b.name);
  });
}

/** "Recent arrivals" (operator ruling: first-seen only) — newest first, never-seen skipped. */
export function recentArrivals(
  members: readonly ServerMemberRecord[],
): GuildServerArrival[] {
  const seen = members.flatMap((r) =>
    r.firstSeenAt === null ? [] : [{ r, at: r.firstSeenAt }],
  );
  return seen
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, RECENT_ARRIVALS_LIMIT)
    .map(({ r, at }) => ({
      memberId: r.memberId,
      name: r.name,
      characterName: r.characterName,
      firstSeenAt: at.toISOString(),
    }));
}

/** Inputs of `buildServerHubPage`. */
export interface ServerHubPageInput {
  guild: GuildSummary;
  role: LadderRole;
  viewerId: number;
  members: ServerMemberRecord[];
  onlineSteamIds: Set<string>;
  /** The hero block minus `viewerJoined`; undefined when the server is gone or unmapped. */
  server: Omit<GuildPageServer, 'viewerJoined'> | undefined;
}

function withViewer(
  server: Omit<GuildPageServer, 'viewerJoined'>,
  viewerJoined: boolean,
  members: readonly ServerMemberRecord[],
): GuildPageServer {
  return { ...server, viewerJoined, recentArrivals: recentArrivals(members) };
}

/** ROK-1831: the `game_server` hub page — one unranked group, zero role counts. */
export function buildServerHubPage(input: ServerHubPageInput): GuildPage {
  const rows = input.members.map((r) =>
    toServerMemberRow(
      r,
      r.steamId !== null && input.onlineSteamIds.has(r.steamId),
    ),
  );
  const viewer = input.members.find((r) => r.userId === input.viewerId);
  const viewerJoined =
    viewer !== undefined && viewer.joinedAt !== null && viewer.leftAt === null;
  return {
    guild: { ...input.guild, memberCount: rows.length },
    importedBy: null,
    viewer: viewerAccess(input.role),
    ranks: [
      { rankIndex: null, rankName: null, members: orderServerMembers(rows) },
    ],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    ...(input.server
      ? { server: withViewer(input.server, viewerJoined, input.members) }
      : {}),
  };
}
