import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { ChannelBindingsService } from './channel-bindings.service';
import type { ChannelResolverService } from './channel-resolver.service';
import type { SettingsService } from '../../settings/settings.service';
import {
  QUICK_PLAY_GAME_COLUMNS,
  toQuickPlayGame,
  type EmbedGame,
} from './embed-game.helpers';

/** Participant with active status for embed building. */
export interface AdHocParticipant {
  /** Null for a Steam-only (game-server) participant (ROK-1800). */
  discordUserId: string | null;
  discordUsername: string;
  isActive: boolean;
  /** ROK-1801: trusted roster marker (` 🖥` / ` 🖥 on server`), card only. */
  rosterSuffix?: string;
  /**
   * ROK-1801 Q4: an unnamed, unlinked server player whose stored username is
   * its SteamID64. Never rendered by name — counted into `+N on server`.
   */
  anonymousOnServer?: boolean;
}

/** A stored participant row's identity columns. */
type ParticipantIdentity = {
  discordUserId: string | null;
  discordUsername: string;
  steamId: string | null;
};

/**
 * ROK-1801 Q4: ROK-1800 stores an unnamed, unlinked server player with its
 * SteamID64 as `discordUsername`. Such a row must never render by name.
 */
export function isAnonymousServerRow(row: ParticipantIdentity): boolean {
  return (
    row.discordUserId === null &&
    row.steamId !== null &&
    row.discordUsername === row.steamId
  );
}

/** Dependencies for ad-hoc notification helper functions. */
export interface AdHocNotificationDeps {
  db: PostgresJsDatabase<typeof schema>;
  channelBindingsService: ChannelBindingsService;
  channelResolver: ChannelResolverService;
  settingsService: SettingsService;
}

/** Mark all participants as active. */
export function toActiveParticipants(
  participants: Array<{
    discordUserId: string | null;
    discordUsername: string;
  }>,
): AdHocParticipant[] {
  return participants.map((p) => ({
    discordUserId: p.discordUserId,
    discordUsername: p.discordUsername,
    isActive: true,
  }));
}

/** Mark all participants as inactive. */
export function toInactiveParticipants(
  participants: Array<{
    discordUserId: string | null;
    discordUsername: string;
  }>,
): AdHocParticipant[] {
  return participants.map((p) => ({
    discordUserId: p.discordUserId,
    discordUsername: p.discordUsername,
    isActive: false,
  }));
}

/**
 * Build a standard EmbedEventData from the DB for an ad-hoc event.
 * Fetches the event, game (with cover art), and formats participants
 * as signupMentions so the standard embed layout renders them.
 */
export async function buildEmbedEventData(
  deps: AdHocNotificationDeps,
  eventId: number,
  participants: AdHocParticipant[],
): Promise<EmbedEventData | null> {
  const event = await fetchEvent(deps.db, eventId);
  if (!event) return null;

  const game = await resolveGame(deps.db, event.gameId);
  const voiceChannelId = await resolveVoice(deps, event);
  return assembleEmbedData(event, participants, game, voiceChannelId);
}

/** Fetch a single event by ID. */
async function fetchEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<typeof schema.events.$inferSelect | null> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/**
 * Resolve the game the Quick Play embed renders: id + name + cover art
 * (ROK-1460: the id drives the title link) plus the sale / co-op columns the
 * badges read (ROK-1447). The projection stays a bounded column map — a bare
 * `select()` would drag ~40 columns into every 5s embed re-sync.
 */
async function resolveGame(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number | null,
): Promise<EmbedGame | null> {
  if (!gameId) return null;
  const [row] = await db
    .select(QUICK_PLAY_GAME_COLUMNS)
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return toQuickPlayGame(row);
}

/** Resolve voice channel, honoring a voice-only per-event override (ROK-1389). */
async function resolveVoice(
  deps: AdHocNotificationDeps,
  event: typeof schema.events.$inferSelect,
): Promise<string | null> {
  return deps.channelResolver.resolveVoiceChannelHonoringOverride(
    event.gameId,
    event.recurrenceGroupId,
    event.ephemeralVoiceChannelId,
    event.notificationChannelOverride,
  );
}

/** Participants as render-only roster mentions (no `<@id>`; see below). */
function rosterMentions(
  participants: AdHocParticipant[],
): NonNullable<EmbedEventData['signupMentions']> {
  return participants
    .filter((p) => !p.anonymousOnServer)
    .map((p) => ({
    discordId: null,
    username: p.discordUsername,
    role: null,
    preferredRoles: null,
    ...(p.isActive ? {} : { status: 'left' }),
    ...(p.rosterSuffix ? { rosterSuffix: p.rosterSuffix } : {}),
  }));
}

/** Assemble EmbedEventData from resolved components. */
function assembleEmbedData(
  event: typeof schema.events.$inferSelect,
  participants: AdHocParticipant[],
  game: EmbedGame | null,
  voiceChannelId: string | null,
): EmbedEventData {
  const effectiveEnd = event.extendedUntil ?? event.duration[1];
  const data: EmbedEventData = {
    id: event.id,
    title: event.title,
    startTime: event.duration[0].toISOString(),
    endTime: effectiveEnd.toISOString(),
    // ROK-1243: ROSTER header reflects cumulative participation, not currently-active.
    signupCount: participants.length,
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as Exclude<
      EmbedEventData['slotConfig'],
      undefined
    >,
    ...(game ? { game } : {}),
    // Quick-play rosters render the stored username as plain text rather than a
    // <@id> mention: ad-hoc participants are voice-presence based and frequently
    // include users Discord can't resolve in the embed (left the guild / not
    // cached), which leaked literal "<@1234>" tokens — especially on the COMPLETED
    // embed re-rendered hours after the session ended (ROK). discordId is dropped
    // here (render-only field) so the shared roster layout falls back to username.
    signupMentions: rosterMentions(participants),
  };
  const anonymous = participants.filter(
    (p) => p.anonymousOnServer && p.isActive,
  ).length;
  if (anonymous > 0) data.serverAnonymousCount = anonymous;
  if (voiceChannelId) data.voiceChannelId = voiceChannelId;
  return data;
}

/**
 * ROK-1446 D9 — is `bindingId` a `general-lobby` voice binding?
 *
 * Returns the bound VOICE channel id (the room `ChannelPresenceEmbedService`
 * renders), or `null` for every other binding.
 *
 * **Strict positive equality on purpose.** A binding whose `bindingPurpose` is
 * anything else — including missing, because a partial row or an older record
 * carries no purpose — is NOT a lobby and keeps the per-event announce. The
 * tempting negation (`!== 'game-voice-monitor'`) would suppress real announces
 * for `game-announcements` and unset bindings alike.
 *
 * Reads the binding through the existing full-row `getBindingById`, so this
 * costs one lookup and adds no new query shape.
 */
export async function isGeneralLobbyBinding(
  deps: AdHocNotificationDeps,
  bindingId: string,
): Promise<{ channelId: string } | null> {
  const binding = await deps.channelBindingsService.getBindingById(bindingId);
  if (!binding || binding.bindingPurpose !== 'general-lobby') return null;
  return { channelId: binding.channelId };
}

/**
 * Resolve the notification channel for a binding (ROK-1390).
 * Priority: 1) explicit notificationChannelId in config,
 *           2) series announce slot (ROK-1351) for a series-linked binding,
 *           3) game-announcements binding for the EFFECTIVE game
 *              (runtime game fallback), falling back to the binding game,
 *           4) default bot channel,
 *           5) null → caller skips posting (existing null-guard).
 */
export async function resolveNotificationChannel(
  deps: AdHocNotificationDeps,
  bindingId: string,
  effectiveGameId?: number | null,
): Promise<string | null> {
  const binding = await deps.channelBindingsService.getBindingById(bindingId);
  if (!binding) return null;
  const configChannel = extractConfigChannel(binding.config);
  if (configChannel) return configChannel;
  const seriesChannel = await findSeriesAnnounceChannel(deps, binding);
  if (seriesChannel) return seriesChannel;
  // ROK-1394: distinguish "no runtime game resolved" (undefined → fall back to
  // the sticky bind game) from a "deliberate null-game degrade" (null → stays
  // null so the game-announcements tier is skipped and an Untitled session does
  // NOT route to the bind game's #announcements channel). `?? binding.gameId`
  // would wrongly resurrect the sticky game for the degrade path.
  const announceGameId =
    effectiveGameId !== undefined ? effectiveGameId : binding.gameId;
  if (announceGameId && binding.guildId) {
    const found = await findAnnouncementChannel(deps, {
      guildId: binding.guildId,
      gameId: announceGameId,
    });
    if (found) return found;
  }
  return deps.settingsService.getDiscordBotDefaultChannel();
}

/**
 * Find the series-level announce channel (ROK-1351) for a series-linked
 * binding. Graceful fallthrough (null) when the binding is not series-linked
 * or the series has no announce slot bound.
 */
async function findSeriesAnnounceChannel(
  deps: AdHocNotificationDeps,
  binding: { guildId?: string | null; recurrenceGroupId?: string | null },
): Promise<string | null> {
  if (!binding.guildId || !binding.recurrenceGroupId) return null;
  return deps.channelBindingsService.getChannelForSeries(
    binding.guildId,
    binding.recurrenceGroupId,
  );
}

/** Extract notificationChannelId from binding config. */
function extractConfigChannel(config: unknown): string | null {
  const typed = config as { notificationChannelId?: string } | null;
  return typed?.notificationChannelId ?? null;
}

/** Find a game-announcements binding for the same game. */
async function findAnnouncementChannel(
  deps: AdHocNotificationDeps,
  binding: { guildId: string; gameId: number | null },
): Promise<string | null> {
  const bindings = await deps.channelBindingsService.getBindings(
    binding.guildId,
  );
  const match = bindings.find(
    (b) =>
      b.bindingPurpose === 'game-announcements' && b.gameId === binding.gameId,
  );
  return match?.channelId ?? null;
}

/** Build embed context from settings. */
export async function buildContext(
  deps: AdHocNotificationDeps,
): Promise<EmbedContext> {
  const [branding, clientUrl, timezone] = await Promise.all([
    deps.settingsService.getBranding(),
    deps.settingsService.getClientUrl(),
    deps.settingsService.getDefaultTimezone(),
  ]);
  return {
    communityName: branding.communityName,
    clientUrl,
    timezone,
  };
}

/**
 * Every `ad_hoc_participants` row of an event as a card roster. `allInactive`
 * (ROK-1243, the COMPLETED card) marks everyone left — the session is over.
 */
export async function readParticipants(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  allInactive = false,
): Promise<AdHocParticipant[]> {
  const rows = await db
    .select()
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
  return rows.map((r) => ({
    discordUserId: r.discordUserId,
    discordUsername: r.discordUsername,
    isActive: !allInactive && !r.leftAt,
    ...(isAnonymousServerRow(r) ? { anonymousOnServer: true } : {}),
  }));
}
