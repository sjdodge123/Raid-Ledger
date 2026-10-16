/**
 * ROK-1446 / ROK-1801 — roster helpers for the presence card's room truth.
 *
 * Split out of `channel-presence-room.helpers.ts` for the 300-line cap (ROK-1801
 * layer C): the evented roster union, the render order, the id → name map, and
 * the game-server markers (operator rulings Q4 + Q8):
 *   - voice member on the game's server → `**Name** 🖥`
 *   - on the server, not in this channel → `**Name** 🖥 on server`
 *   - unnamed unlinked server player   → `+N on server` (never a SteamID)
 * Markers sit OUTSIDE the bold as trusted `RosterEntry.suffix` strings, so a
 * display name can never smuggle one in (and `formatRoster` still escapes it).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { formatRoster, type RosterEntry } from '../embeds/embed-roster.helpers';
import {
  groupSize,
  serverOnlySummary,
} from '../listeners/voice-lobby-server-merge.helpers';
import type { LobbyGameGroup } from '../listeners/voice-lobby-groups.helpers';
import type { AdHocParticipant } from './ad-hoc-notification.helpers';
import type { RoomGroup } from './channel-presence-room.helpers';
import type { RoomSource } from './channel-presence-room.snapshot';

/** ` 🖥` — in voice AND on the game's server. */
export const ON_SERVER_MARK = ' \u{1F5A5}';
/** ` 🖥 on server` — on the game's server, not in this voice channel. */
export const SERVER_ONLY_MARK = ' \u{1F5A5} on server';

/** What the evented union reads off a group (detected or rendered). */
type RosterGroup = Pick<
  LobbyGameGroup,
  'memberIds' | 'onServerIds' | 'serverOnly'
>;

type ParticipantRow = {
  discordUserId: string | null;
  discordUsername: string;
  steamId: string | null;
  leftAt: Date | null;
  onServer: boolean;
};

/** A row's server marker: ` 🖥` while in voice, ` 🖥 on server` otherwise. */
function rowSuffix(
  row: ParticipantRow,
  group: RosterGroup,
): Record<string, never> | { rosterSuffix: string } {
  const id = row.discordUserId;
  const inVoice = id !== null && group.memberIds.includes(id);
  const onServer =
    (row.onServer && row.leftAt === null) ||
    (id !== null && (group.onServerIds ?? []).includes(id));
  if (!onServer) return {};
  return { rosterSuffix: inVoice ? ON_SERVER_MARK : SERVER_ONLY_MARK };
}

/** Named server-only players no stored row already covers (by id or SteamID). */
function unrowedServerOnly(
  rows: ParticipantRow[],
  group: RosterGroup,
): AdHocParticipant[] {
  const ids = new Set(rows.map((r) => r.discordUserId));
  const steam = new Set(rows.map((r) => r.steamId));
  return (group.serverOnly ?? []).flatMap((e) =>
    e.name === null ||
    steam.has(e.steamId) ||
    (e.discordUserId !== null && ids.has(e.discordUserId))
      ? []
      : [
          {
            discordUserId: e.discordUserId,
            discordUsername: e.name,
            isActive: true,
            rosterSuffix: SERVER_ONLY_MARK,
          },
        ],
  );
}

/** Every stored participant row of an event, with its server flags. */
function readParticipantRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<ParticipantRow[]> {
  const t = schema.adHocParticipants;
  return db
    .select({
      discordUserId: t.discordUserId,
      discordUsername: t.discordUsername,
      steamId: t.steamId,
      leftAt: t.leftAt,
      onServer: t.onServer,
    })
    .from(t)
    .where(eq(t.eventId, eventId));
}

/**
 * Roster for an evented group: the stored `ad_hoc_participants` rows (leavers
 * kept, marked inactive — ROK-1243) UNION the live group members who have no
 * row yet, so someone who just joined voice still renders before the
 * participant write lands. ROK-1801: rows on the server carry the 🖥 marker,
 * and named server-only players with no row yet are appended.
 */
export async function unionParticipants(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  group: RosterGroup,
  source: RoomSource,
): Promise<AdHocParticipant[]> {
  const rows = await readParticipantRows(db, eventId);
  const known = new Set(rows.map((r) => r.discordUserId));
  const onServer = new Set(group.onServerIds ?? []);
  return [
    ...rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
      ...rowSuffix(r, group),
    })),
    ...group.memberIds
      .filter((id) => !known.has(id))
      .map((id) => ({
        discordUserId: id,
        discordUsername: source.names.get(id) ?? id,
        isActive: true,
        ...(onServer.has(id) ? { rosterSuffix: ON_SERVER_MARK } : {}),
      })),
    ...unrowedServerOnly(rows, group),
  ];
}

/** Render order (D2): evented groups first, then size desc, then name asc. */
export function sortGroups(groups: RoomGroup[]): RoomGroup[] {
  return [...groups].sort((a, b) => {
    const evented = Number(b.eventData !== null) - Number(a.eventData !== null);
    if (evented !== 0) return evented;
    const size = groupSize(b) - groupSize(a);
    if (size !== 0) return size;
    return a.gameName.localeCompare(b.gameName);
  });
}

/** Map ids to display names, falling back to the raw id. */
export function namesOf(ids: string[], names: Map<string, string>): string[] {
  return ids.map((id) => names.get(id) ?? id);
}

/**
 * A short group's roster entries: voice members (` 🖥` when on the server),
 * then named server-only players (` 🖥 on server`). `memberNames` stays
 * index-aligned to `memberIds`.
 */
export function groupRosterEntries(group: RoomGroup): RosterEntry[] {
  const onServer = new Set(group.onServerIds ?? []);
  const voice = group.memberNames.map((name, i) => {
    const id = group.memberIds[i];
    return id !== undefined && onServer.has(id)
      ? { name, suffix: ON_SERVER_MARK }
      : { name };
  });
  const serverOnly = serverOnlySummary(group).named.map((name) => ({
    name,
    suffix: SERVER_ONLY_MARK,
  }));
  return [...voice, ...serverOnly];
}

/**
 * The short group's description: bold roster, then the anonymous aggregate
 * `+N on server` (Q4). `''` when there is nobody to list.
 */
export function formatGroupRoster(group: RoomGroup, cap: number): string {
  const roster = formatRoster(groupRosterEntries(group), cap);
  const { anonymousCount } = serverOnlySummary(group);
  if (anonymousCount === 0) return roster;
  const anonymous = `+${String(anonymousCount)} on server`;
  return roster ? `${roster} · ${anonymous}` : anonymous;
}
