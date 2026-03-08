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

/** Resolve voice channel with per-event override priority. */
async function resolveVoice(
  deps: AdHocNotificationDeps,
  event: typeof schema.events.$inferSelect,
): Promise<string | null> {
  return (
    event.notificationChannelOverride ??
    (await deps.channelResolver.resolveVoiceChannelForScheduledEvent(
      event.gameId,
      event.recurrenceGroupId,
    ))
  );
}

/** Assemble EmbedEventData from resolved components. */
function assembleEmbedData(
  event: typeof schema.events.$inferSelect,
  participants: AdHocParticipant[],
  game: { name: string; coverUrl?: string | null } | null,
  voiceChannelId: string | null,
): EmbedEventData {
  const active = participants.filter((p) => p.isActive);
  const effectiveEnd = event.extendedUntil ?? event.duration[1];
  const data: EmbedEventData = {
    id: event.id,
    title: event.title,
    startTime: event.duration[0].toISOString(),
    endTime: effectiveEnd.toISOString(),
    signupCount: active.length,
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    game: game ?? undefined,
    signupMentions: participants.map((p) => ({
      discordId: p.discordUserId,
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
 * Resolve the notification channel for a binding.
 * Priority: 1) explicit notificationChannelId in config,
 *           2) game-announcements binding for the same game,
 *           3) default bot channel.
 */
export async function resolveNotificationChannel(
  deps: AdHocNotificationDeps,
  bindingId: string,
): Promise<string | null> {
  const binding = await deps.channelBindingsService.getBindingById(bindingId);
  if (!binding) return null;
  const configChannel = extractConfigChannel(binding.config);
  if (configChannel) return configChannel;
  if (binding.gameId && binding.guildId) {
    const found = await findAnnouncementChannel(deps, binding);
    if (found) return found;
  }
  return deps.settingsService.getDiscordBotDefaultChannel();
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
