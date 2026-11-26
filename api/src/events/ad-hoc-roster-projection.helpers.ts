import { createHmac, randomBytes } from 'node:crypto';
import type {
  AdHocParticipantDto,
  AdHocRosterResponseDto,
} from '@raid-ledger/contract';

/**
 * ROK-2323 — the ad-hoc / voice roster as any signed-in viewer may see it.
 *
 * The full roster carries each participant's Discord snowflake, SteamID64 and
 * platform player id, and an anonymous game-server player's display name can
 * BE their SteamID64. Only the event owner or an admin/operator receives that
 * detail; everyone else (and every `roster:update` socket broadcast, which
 * goes to any subscriber of the event room) gets this projection. A linked
 * row keeps its Discord id + avatar hash (see `viewerDiscordFields`).
 */

/** The name a non-owner sees for a server player whose name is a platform id. */
export const ANON_SERVER_PLAYER_LABEL = 'Server player';

/** A SteamID64, Xbox XUID or Minecraft UUID used verbatim as a name. */
const PLATFORM_ID_NAME =
  /^(\d{15,20}|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i;

function nameIsPlatformId(p: AdHocParticipantDto): boolean {
  const name = p.discordUsername.trim();
  if (name === p.steamId || name === p.playerId) return true;
  return PLATFORM_ID_NAME.test(name);
}

/** Per-process key: a row id derived from a Discord id cannot be reversed. */
const ROW_ID_KEY = randomBytes(32);

/** Formats 32 hex chars as an RFC 4122 v4 UUID (version + variant nibbles set). */
function hexToUuidV4(h: string): string {
  const variant = '89ab'.charAt(parseInt(h.charAt(16), 16) & 3);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The live voice roster (planned events) uses the Discord snowflake as the
 * row id; a viewer gets a stable, non-reversible stand-in instead. Keyed by
 * event too, so one Discord user's rows cannot be correlated across events.
 */
function viewerRowId(p: AdHocParticipantDto): string {
  if (!p.discordUserId || p.id !== p.discordUserId) return p.id;
  const h = createHmac('sha256', ROW_ID_KEY)
    .update(`${p.eventId}:${p.id}`)
    .digest('hex');
  return hexToUuidV4(h);
}

/**
 * A LINKED participant's Discord id already reaches every signed-in member
 * (`GET /users` → `UserPreviewSchema.discordId`; `GET /events/:id/roster` →
 * `SignupUserSchema.discordId`), so hiding it here bought no privacy and cost
 * the avatar: a linked row keeps its id + avatar hash. An unlinked voice user
 * (no Raid Ledger account) is not exposed anywhere else — no id, initials.
 */
function viewerDiscordFields(
  p: AdHocParticipantDto,
): Pick<AdHocParticipantDto, 'discordUserId' | 'discordAvatarHash'> {
  if (p.userId === null || !p.discordUserId) return { discordAvatarHash: null };
  return {
    discordUserId: p.discordUserId,
    discordAvatarHash: p.discordAvatarHash,
  };
}

/** True for a row whose name may be a raw platform id: an unlinked server player. */
function isAnonServerPlayer(p: AdHocParticipantDto): boolean {
  return p.userId === null && !p.discordUserId && p.source === 'steam';
}

/**
 * One participant without its Steam / platform ids (and, when unlinked, its
 * Discord id). An allow-list:
 * a field added to the DTO later stays owner-only until it is listed here.
 */
export function toViewerParticipant(
  p: AdHocParticipantDto,
): AdHocParticipantDto {
  const anonName = isAnonServerPlayer(p) && nameIsPlatformId(p);
  return {
    id: viewerRowId(p),
    eventId: p.eventId,
    userId: p.userId,
    hasDiscord: p.hasDiscord ?? Boolean(p.discordUserId),
    ...(p.source !== undefined ? { source: p.source } : {}),
    ...(p.inVoice !== undefined ? { inVoice: p.inVoice } : {}),
    ...(p.onServer !== undefined ? { onServer: p.onServer } : {}),
    discordUsername: anonName ? ANON_SERVER_PLAYER_LABEL : p.discordUsername,
    ...viewerDiscordFields(p),
    joinedAt: p.joinedAt,
    leftAt: p.leftAt,
    totalDurationSeconds: p.totalDurationSeconds,
    sessionCount: p.sessionCount,
  };
}

/** Every participant projected for a non-owner viewer. */
export function toViewerParticipants(
  participants: AdHocParticipantDto[],
): AdHocParticipantDto[] {
  return participants.map(toViewerParticipant);
}

/** The whole roster response projected for a non-owner viewer. */
export function toViewerRoster(
  roster: AdHocRosterResponseDto,
): AdHocRosterResponseDto {
  return { ...roster, participants: toViewerParticipants(roster.participants) };
}

/** Owner/admin detail rows also say whether a Discord identity is present. */
export function withHasDiscord(
  roster: AdHocRosterResponseDto,
): AdHocRosterResponseDto {
  return {
    ...roster,
    participants: roster.participants.map((p) => ({
      ...p,
      hasDiscord: p.hasDiscord ?? Boolean(p.discordUserId),
    })),
  };
}
