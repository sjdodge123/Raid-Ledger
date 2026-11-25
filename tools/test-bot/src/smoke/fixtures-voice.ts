/**
 * Voice-session and lobby-presence fixtures (ROK-943 / ROK-1446 / ROK-1801).
 * Split out of `fixtures.ts`, which re-exports everything here.
 */
import type { ApiClient } from "./api.js";

/** Inject a synthetic voice session into the DB — DEMO_MODE only (ROK-943). */
export async function injectVoiceSession(
  api: ApiClient,
  p: {
    eventId: number;
    discordUserId: string;
    userId: number;
    durationSec: number;
    firstJoinAt?: string;
    lastLeaveAt?: string;
  },
): Promise<void> {
  await api.post("/admin/test/inject-voice-session", p);
}

/**
 * One human occupant of a bound lobby room, as the ROK-1446 D12 seam takes it.
 *
 * A 1:1 mirror of the API's `LobbyPresenceMemberSchema`. `gameId` is a REQUIRED
 * key that may be `null` — `null` means "in channel · no game detected", and
 * the endpoint 400s on a missing key so silence can never be mistaken for it.
 * There is deliberately no `bot` flag: the seam stands in for the Discord read
 * only, and the schema strips unknown keys, so it cannot smuggle a bot onto the
 * embed even though it bypasses `humanMembers` (AC3).
 */
export interface LobbyPresenceMember {
  discordUserId: string;
  /** Rendered name — rosters are bold plain text, never `<@id>` mentions. */
  displayName: string;
  /** Required key; `null` = presence produced no game for this member. */
  gameId: number | null;
  /** Links this member's game group to an existing event. */
  eventId?: number;
  /** ROK-1801: also on `gameId`'s game server — renders ` 🖥` after the name. */
  onServer?: boolean;
}

/**
 * ROK-1801: a player on a game server but NOT in the voice channel. A 1:1
 * mirror of the API's `LobbyServerOnlySchema`. `displayName: null` is an
 * unlinked, unnamed server player — it renders only as `+N on server`.
 */
export interface LobbyServerOnlyPlayer {
  displayName: string | null;
  gameId: number;
}

/**
 * The ids of the room's OPEN `discord_channel_presence_messages` row.
 *
 * Both are `null` when no open row exists — the normal answer for a
 * `members: null` cleanup call, and for a room whose first flush has not opened
 * one yet (e.g. the binding is not visible to the flush). Callers MUST tolerate
 * that rather than assume a message id.
 */
export interface LobbyPresenceRow {
  textChannelId: string | null;
  messageId: string | null;
}

/**
 * Install (or clear) a DEMO_MODE lobby-presence room override and flush it.
 *
 * The handler order is server-pinned — DEMO_MODE gate → parse →
 * `setRoomOverride` → `flushNow` → read the open row — so by the time this
 * resolves the message has already been posted or edited, and the caller can
 * poll the returned channel/message directly.
 *
 * @param api - Admin API client (same auth as every other `/admin/test/*`).
 * @param voiceChannelId - The bound `general-lobby` voice channel.
 * @param members - The room's occupants. `[]` is an EMPTY room and drives the
 *   recap path; `null` CLEARS the override and hands the channel back to real
 *   Discord reads. The two are different requests — do not conflate them.
 * @param serverOnly - ROK-1801: players on a game server, not in the channel.
 *   Omitted = none (pre-1801 payload shape, which the API still accepts).
 * @returns The open presence row's ids; either may be `null`.
 */
export async function setLobbyPresence(
  api: ApiClient,
  voiceChannelId: string,
  members: LobbyPresenceMember[] | null,
  serverOnly?: LobbyServerOnlyPlayer[],
): Promise<LobbyPresenceRow> {
  return api.post<LobbyPresenceRow>("/admin/test/lobby-presence", {
    voiceChannelId,
    members,
    ...(serverOnly !== undefined ? { serverOnly } : {}),
  });
}
