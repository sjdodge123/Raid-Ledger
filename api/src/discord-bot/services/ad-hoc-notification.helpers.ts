import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { ChannelBindingsService } from './channel-bindings.service';
import type { ChannelResolverService } from './channel-resolver.service';
import type { SettingsService } from '../../settings/settings.service';

/** Participant with active status for embed building. */
export interface AdHocParticipant {
  discordUserId: string;
  discordUsername: string;
  isActive: boolean;
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
  participants: Array<{ discordUserId: string; discordUsername: string }>,
): AdHocParticipant[] {
  return participants.map((p) => ({
    discordUserId: p.discordUserId,
    discordUsername: p.discordUsername,
    isActive: true,
  }));
}

/** Mark all participants as inactive. */
export function toInactiveParticipants(
  participants: Array<{ discordUserId: string; discordUsername: string }>,
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

/** Resolve game name + cover art. */
async function resolveGame(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number | null,
): Promise<{ name: string; coverUrl?: string | null } | null> {
  if (!gameId) return null;
  const [row] = await db
    .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row ?? null;
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

/** Assemble EmbedEventData from resolved components. */
function assembleEmbedData(
  event: typeof schema.events.$inferSelect,
  participants: AdHocParticipant[],
  game: { name: string; coverUrl?: string | null } | null,
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
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    game: game ?? undefined,
    // Quick-play rosters render the stored username as plain text rather than a
    // <@id> mention: ad-hoc participants are voice-presence based and frequently
    // include users Discord can't resolve in the embed (left the guild / not
    // cached), which leaked literal "<@1234>" tokens — especially on the COMPLETED
    // embed re-rendered hours after the session ended (ROK). discordId is dropped
    // here (render-only field) so the shared roster layout falls back to username.
    signupMentions: participants.map((p) => ({
      discordId: null,
      username: p.discordUsername,
      role: null,
      preferredRoles: null,
      ...(p.isActive ? {} : { status: 'left' }),
    })),
  };
  if (voiceChannelId) data.voiceChannelId = voiceChannelId;
  return data;
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
