/**
 * ROK-1446 — room truth for the channel-level Quick Play presence embed.
 *
 * D4 — render from truth, never from deltas: every flush re-derives the room
 * from `humanMembers` + `detectGames` + `partitionLobbyGroups` + the DB's
 * live/grace ad-hoc events, so a missed Discord event self-heals on the next
 * tick and the service never has to import `AdHocEventService` (which would
 * close the DI cycle Presence → AdHocEvent → AdHocNotification → Presence).
 *
 * Nothing here reads `channel.members` directly — `humanMembers` is the ONLY
 * door into the room, which is what keeps bots out of every roster and every
 * count (AC3).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildMember } from 'discord.js';
import * as schema from '../../drizzle/schema';
import type { EmbedEventData } from './discord-embed.factory';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { PresenceGameDetectorService } from './presence-game-detector.service';
import {
  resolveVoiceChannel,
  type ResolvedBinding,
} from '../listeners/voice-state.helpers';
import {
  humanMembers,
  partitionLobbyGroups,
  undetectedMemberIds,
  type LobbyGameGroup,
} from '../listeners/voice-lobby-groups.helpers';
import {
  buildEmbedEventData,
  type AdHocNotificationDeps,
  type AdHocParticipant,
} from './ad-hoc-notification.helpers';
import { fetchGameArt, type GroupGameArt } from './channel-presence-room.art';
import {
  snapshotSource,
  type RoomSnapshot,
  type RoomSource,
} from './channel-presence-room.snapshot';

export type {
  RoomMemberSnapshot,
  RoomSnapshot,
} from './channel-presence-room.snapshot';
export type { GroupGameArt } from './channel-presence-room.art';

/** Ad-hoc statuses whose event is still rendering as a live session (D4). */
const LIVE_AD_HOC_STATUSES = ['live', 'grace_period'];

/** An ad-hoc event this binding owns, projected to what the renderer needs. */
export interface LinkedEvent {
  id: number;
  gameId: number | null;
  adHocStatus: string | null;
}

/**
 * One detected game group in the room, ready to render.
 *
 * `eventId` and `eventData` are non-null together or null together: a group is
 * "evented" (AC4 — renders `buildQuickPlayEmbed`) exactly when `eventData` is
 * present. `qualifying` is the SEPARATE threshold fact — a group can be short
 * yet still evented (the event outlived a departure), so the renderer must read
 * `eventData` for the evented/short branch and `qualifying` only for the
 * `◌ NEEDS N MORE` copy.
 */
export interface RoomGroup {
  gameId: number | null;
  gameName: string;
  memberIds: string[];
  /** Display names, index-aligned to `memberIds`. */
  memberNames: string[];
  /** Clears the binding's `minPlayers`. */
  qualifying: boolean;
  eventId: number | null;
  eventData: EmbedEventData | null;
  /**
   * Cover art + badge inputs, on EVERY group rather than only evented ones
   * (Lead ruling 1). A short group has no `EmbedEventData` to inherit them
   * from, and D2 still gives it "same badge fields, thumbnail". `null` when
   * the group has no game (Just Chatting) or its games row has vanished.
   */
  game: GroupGameArt | null;
}

/** The whole room as one flush sees it (D4). */
export interface ResolvedRoom {
  channelId: string;
  /** `null` when the voice channel no longer resolves. */
  channelName: string | null;
  /** Human occupants — bots excluded (AC3). */
  memberCount: number;
  minPlayers: number;
  /** Already in render order: evented first, then size desc, then name asc. */
  groups: RoomGroup[];
  /**
   * Names for the lead embed's "In channel · no game detected" field (D3).
   * Empty when `allowJustChatting` is on, because those members then render as
   * their own `💬 Just Chatting` group and must not be listed twice.
   */
  undetectedNames: string[];
  /**
   * Did the Discord voice channel actually resolve on this flush? (S-2)
   *
   * `resolveVoiceChannel` returns null for FIVE distinct conditions - no
   * client, no guild id, guild not cached, channel not cached, channel not
   * voice-based - and every one of them lands here as `memberCount: 0`, which
   * is indistinguishable from a genuinely empty room. Without this
   * discriminator a cold channel cache (which `recover()` maximises the chance
   * of, by marking every open row dirty at reconnect) stamps `empty_since` and
   * rewrites a LIVE session's message into a recap. "I could not look" is not
   * "nobody is there".
   *
   * Optional only so hand-built rooms in specs stay terse; `resolveRoom`'s
   * return type makes it REQUIRED there, so the one real producer cannot omit
   * it. Absent therefore means "not produced by `resolveRoom`" and is treated
   * as resolved; only an explicit `false` skips the flush.
   */
  channelResolved?: boolean;
}

/** Everything `resolveRoom` needs: the DB, Discord, and the embed builder's deps. */
export interface RoomResolveDeps extends AdHocNotificationDeps {
  clientService: DiscordBotClientService;
  presenceDetector: PresenceGameDetectorService;
}

/** Ad-hoc events under a binding that are still live or in grace (D4). */
export async function findLinkedEvents(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
): Promise<LinkedEvent[]> {
  return db
    .select({
      id: schema.events.id,
      gameId: schema.events.gameId,
      adHocStatus: schema.events.adHocStatus,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, true),
        eq(schema.events.channelBindingId, bindingId),
        inArray(schema.events.adHocStatus, LIVE_AD_HOC_STATUSES),
        isNull(schema.events.cancelledAt),
      ),
    );
}

/**
 * Every ad-hoc session this message has covered since it opened (D8 recap).
 *
 * `>=` is deliberate: a session that started in the same instant the row opened
 * belongs to this message. `>` would silently drop the very first session of a
 * room that spawned an event on the same flush that created the row.
 */
export async function recapEvents(
  db: PostgresJsDatabase<typeof schema>,
  bindingId: string,
  openedAt: Date,
): Promise<LinkedEvent[]> {
  return db
    .select({
      id: schema.events.id,
      gameId: schema.events.gameId,
      adHocStatus: schema.events.adHocStatus,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, true),
        eq(schema.events.channelBindingId, bindingId),
        isNull(schema.events.cancelledAt),
        // OVERLAP, not "started after" (P2-3). The ad-hoc events row is
        // written by the voice handler, which runs BEFORE the presence dirty
        // set drains and stamps `opened_at`. A `lower(duration) >= opened_at`
        // predicate therefore drops - intermittently, on a few seconds of skew
        // between two writers with no shared clock - the very session the
        // message was showing, and the final recap reads "No session started."
        // A session belongs to this message when its interval INTERSECTS the
        // window the message was open for; an open-ended upper bound always
        // does, and `>=` keeps the inclusive boundary the old predicate had.
        sql`(upper(${schema.events.duration}) is null or upper(${schema.events.duration}) >= ${openedAt.toISOString()}::timestamptz)`,
      ),
    );
}

/**
 * Match a group to its event the way SQL's `game_id IS NOT DISTINCT FROM
 * $gameId` would (D4).
 *
 * The trap this exists to name: a null-game group must match the row whose
 * `game_id` is null. SQL `=` never does that, and the equivalent TypeScript bug
 * is a truthiness guard (`if (!gameId) return null`) that silently strips the
 * Just Chatting group of its live event.
 */
export function matchLinkedEvent(
  events: LinkedEvent[],
  gameId: number | null,
): LinkedEvent | null {
  return events.find((e) => e.gameId === gameId) ?? null;
}

/**
 * Derive the whole room for one bound lobby channel (D4).
 *
 * `override` (DEMO_MODE, D12) stands in for the Discord read + detection step
 * ONLY; the threshold partition, the linked-event lookup and the roster union
 * below all still run against the real database.
 */
export async function resolveRoom(
  deps: RoomResolveDeps,
  channelId: string,
  binding: ResolvedBinding,
  override?: RoomSnapshot | null,
): Promise<ResolvedRoom & { channelResolved: boolean }> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  const minPlayers = binding.config?.minPlayers ?? 2;
  const allowJustChatting = binding.config?.allowJustChatting ?? false;
  const source = override
    ? await snapshotSource(deps.db, override)
    : await detectSource(deps, channel ? humanMembers(channel) : []);
  const base = {
    channelId,
    channelName: channel?.name ?? null,
    // The D12 override path has no Discord channel BY DESIGN, so it must keep
    // reporting the room as resolvable - the seam is the source of truth
    // there, not the cache.
    channelResolved: override ? true : channel !== null,
    memberCount: source.memberCount,
    minPlayers,
    undetectedNames: allowJustChatting
      ? []
      : namesOf(undetectedMemberIds(source.detected), source.names),
  };
  const groups = await buildGroups(deps, binding, source, {
    allowJustChatting,
    minPlayers,
  });
  return { ...base, groups };
}

/** Partition the detected groups, then attach each one's linked event. */
async function buildGroups(
  deps: RoomResolveDeps,
  binding: ResolvedBinding,
  source: RoomSource,
  opts: { allowJustChatting: boolean; minPlayers: number },
): Promise<RoomGroup[]> {
  const split = partitionLobbyGroups(
    source.detected,
    opts.allowJustChatting,
    opts.minPlayers,
  );
  const pending = [
    ...split.qualifying.map((g) => ({ group: g, qualifying: true })),
    ...split.dropped.map((g) => ({ group: g, qualifying: false })),
  ];
  if (pending.length === 0) return [];
  const linked = await findLinkedEvents(deps.db, binding.bindingId);
  const groups = await Promise.all(
    pending.map((p) =>
      toRoomGroup(deps, p.group, p.qualifying, source, linked),
    ),
  );
  return sortGroups(groups);
}

/** Build one renderable group, resolving its event and roster if it has one. */
async function toRoomGroup(
  deps: RoomResolveDeps,
  group: LobbyGameGroup,
  qualifying: boolean,
  source: RoomSource,
  linked: LinkedEvent[],
): Promise<RoomGroup> {
  const eventId =
    matchLinkedEvent(linked, group.gameId)?.id ?? hintedEventId(group, source);
  const eventData =
    eventId === null
      ? null
      : await buildEmbedEventData(
          deps,
          eventId,
          await unionParticipants(deps.db, eventId, group.memberIds, source),
        );
  return {
    gameId: group.gameId,
    gameName: group.gameName,
    memberIds: group.memberIds,
    memberNames: namesOf(group.memberIds, source.names),
    qualifying,
    eventId: eventData ? eventId : null,
    eventData,
    game: (group.gameId === null ? null : source.art.get(group.gameId)) ?? null,
  };
}

/**
 * The event id a D12 snapshot declared for this group, used ONLY when the real
 * lookup found nothing — the seam supplements the DB, it never overrides it.
 */
function hintedEventId(
  group: LobbyGameGroup,
  source: RoomSource,
): number | null {
  for (const id of group.memberIds) {
    const hint = source.eventHints.get(id);
    if (hint !== undefined) return hint;
  }
  return null;
}

/**
 * Roster for an evented group: the stored `ad_hoc_participants` rows (leavers
 * kept, marked inactive — ROK-1243) UNION the live group members who have no
 * row yet, so someone who just joined voice still renders before the
 * participant write lands.
 */
async function unionParticipants(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  memberIds: string[],
  source: RoomSource,
): Promise<AdHocParticipant[]> {
  const rows = await db
    .select({
      discordUserId: schema.adHocParticipants.discordUserId,
      discordUsername: schema.adHocParticipants.discordUsername,
      leftAt: schema.adHocParticipants.leftAt,
    })
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
  const known = new Set(rows.map((r) => r.discordUserId));
  return [
    ...rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
    })),
    ...memberIds
      .filter((id) => !known.has(id))
      .map((id) => ({
        discordUserId: id,
        discordUsername: source.names.get(id) ?? id,
        isActive: true,
      })),
  ];
}

/** Render order (D2): evented groups first, then size desc, then name asc. */
function sortGroups(groups: RoomGroup[]): RoomGroup[] {
  return [...groups].sort((a, b) => {
    const evented = Number(b.eventData !== null) - Number(a.eventData !== null);
    if (evented !== 0) return evented;
    const size = b.memberIds.length - a.memberIds.length;
    if (size !== 0) return size;
    return a.gameName.localeCompare(b.gameName);
  });
}

/** The live path: Discord members (bots already filtered) through detection. */
async function detectSource(
  deps: RoomResolveDeps,
  members: GuildMember[],
): Promise<RoomSource> {
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const detected =
    members.length === 0
      ? []
      : await deps.presenceDetector.detectGames(members);
  const art = await fetchGameArt(
    deps.db,
    detected.map((g) => g.gameId).filter((id): id is number => id !== null),
  );
  return {
    memberCount: members.length,
    names,
    detected,
    art,
    eventHints: new Map(),
  };
}

/** Map ids to display names, falling back to the raw id. */
function namesOf(ids: string[], names: Map<string, string>): string[] {
  return ids.map((id) => names.get(id) ?? id);
}
