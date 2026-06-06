import {
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  DiscordAPIError,
} from 'discord.js';
import {
  UNKNOWN_SCHEDULED_EVENT,
  MAX_SCHEDULED_EVENTS_REACHED,
  timedDiscordCall,
  type ScheduledEventData,
} from './scheduled-event.helpers';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ScheduledEventRecord } from './scheduled-event.db-helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

interface VoiceChannelResolver {
  resolveVoiceChannelForScheduledEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null>;
}

export function isUnknownEventError(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError && error.code === UNKNOWN_SCHEDULED_EVENT
  );
}

/**
 * Discord error 30038 — the guild is at the 100-uncompleted-scheduled-events
 * hard cap. Used by `withCapacityRecovery` to trigger a GC sweep + single
 * retry instead of letting the cron loop forever (ROK-1332).
 */
export function isAtScheduledEventCapacityError(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    error.code === MAX_SCHEDULED_EVENTS_REACHED
  );
}

export function isTerminalStatus(status: GuildScheduledEventStatus): boolean {
  return (
    status === GuildScheduledEventStatus.Completed ||
    status === GuildScheduledEventStatus.Canceled
  );
}

export async function tryStartEvent(
  guild: Guild,
  candidate: { id: number; discordScheduledEventId: string | null },
): Promise<{ cleared: boolean; error?: unknown }> {
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => guild.scheduledEvents.fetch(candidate.discordScheduledEventId!),
      { eventId: candidate.id },
    );
    if (se.status !== GuildScheduledEventStatus.Scheduled) {
      return { cleared: false };
    }

    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(candidate.discordScheduledEventId!, {
          status: GuildScheduledEventStatus.Active,
        }),
      { eventId: candidate.id, op: 'start' },
    );
    return { cleared: false };
  } catch (error) {
    if (isUnknownEventError(error)) return { cleared: true };
    return { cleared: false, error };
  }
}

/**
 * Outcome of a single SE delete attempt. `deleted` is true on a confirmed
 * Discord delete OR when 10070 (UNKNOWN_SCHEDULED_EVENT) is swallowed — the SE
 * is gone either way. On any other failure `deleted` is false and `code`
 * carries the Discord error code (50013 Missing Perms, 429 rate-limit, …) plus
 * `retryAfter` (seconds) when Discord supplied one, so GC logs a reason per
 * orphan instead of aborting the sweep (ROK-1347).
 */
export interface DeleteOutcome {
  deleted: boolean;
  code?: number;
  retryAfter?: number;
}

function discordErrorCode(error: unknown): number | undefined {
  return error instanceof DiscordAPIError && typeof error.code === 'number'
    ? error.code
    : undefined;
}

function discordRetryAfter(error: unknown): number | undefined {
  const ra = (error as { retryAfter?: unknown })?.retryAfter;
  return typeof ra === 'number' ? ra : undefined;
}

export async function tryDeleteEvent(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<DeleteOutcome> {
  try {
    await timedDiscordCall(
      'scheduledEvents.delete',
      () => guild.scheduledEvents.delete(seId),
      { eventId },
    );
    return { deleted: true };
  } catch (error) {
    // 10070 = the SE is already gone in Discord — treat as a successful free.
    if (isUnknownEventError(error)) return { deleted: true };
    return {
      deleted: false,
      code: discordErrorCode(error),
      retryAfter: discordRetryAfter(error),
    };
  }
}

export async function activateAndComplete(
  guild: Guild,
  eventId: number,
  seId: string,
  currentStatus: GuildScheduledEventStatus,
): Promise<void> {
  if (currentStatus === GuildScheduledEventStatus.Scheduled) {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          status: GuildScheduledEventStatus.Active,
        }),
      { eventId, op: 'complete-activate' },
    );
  }

  await timedDiscordCall(
    'scheduledEvents.edit',
    () =>
      guild.scheduledEvents.edit(seId, {
        status: GuildScheduledEventStatus.Completed,
      }),
    { eventId, op: 'complete' },
  );
}

export async function tryCompleteEvent(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<void> {
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => guild.scheduledEvents.fetch(seId),
      { eventId, op: 'complete' },
    );

    if (isTerminalStatus(se.status)) return;
    await activateAndComplete(guild, eventId, seId, se.status);
  } catch (error) {
    if (!isUnknownEventError(error)) throw error;
  }
}

export async function tryEditEndTime(
  guild: Guild,
  eventId: number,
  seId: string,
  newEndTime: Date,
): Promise<boolean> {
  try {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          scheduledEndTime: newEndTime,
        }),
      { eventId, op: 'updateEndTime' },
    );
    return false;
  } catch (error) {
    if (isUnknownEventError(error)) return true;
    throw error;
  }
}

export async function tryEditDescription(
  guild: Guild,
  eventId: number,
  seId: string,
  description: string,
): Promise<boolean> {
  try {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () => guild.scheduledEvents.edit(seId, { description }),
      { eventId, op: 'updateDescription' },
    );
    return false;
  } catch (error) {
    if (isUnknownEventError(error)) return true;
    throw error;
  }
}

/**
 * Resolve the voice channel for a scheduled event edit (ROK-716).
 * If notificationChannelOverride is set and is a voice channel, use it.
 * If it's a text channel, fall back to the channel resolver.
 * If it's not in cache, use it optimistically (may be an uncached voice channel).
 */
export async function resolveVoiceForEdit(
  guild: Guild,
  event: ScheduledEventRecord,
  gameId: number | null | undefined,
  channelResolver: VoiceChannelResolver,
): Promise<string | null> {
  const override = event.notificationChannelOverride;
  if (override) {
    const cached = guild.channels.cache.get(override);
    if (!cached || cached.isVoiceBased()) return override;
  }
  return channelResolver.resolveVoiceChannelForScheduledEvent(
    gameId,
    event.recurrenceGroupId,
  );
}

/** Create a new Discord Scheduled Event via the API (ROK-755 extraction). */
export async function tryCreateNewEvent(
  guild: Guild,
  eventId: number,
  eventData: ScheduledEventData,
  voiceChannelId: string,
  description: string,
): Promise<{ id: string }> {
  return timedDiscordCall(
    'scheduledEvents.create',
    () =>
      guild.scheduledEvents.create({
        name: eventData.title,
        scheduledStartTime: new Date(eventData.startTime),
        scheduledEndTime: new Date(eventData.endTime),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: voiceChannelId,
        description,
      }),
    { eventId },
  );
}

/** Edit all fields of an existing Discord Scheduled Event (ROK-755 extraction). */
export async function tryEditFullEvent(
  guild: Guild,
  eventId: number,
  seId: string,
  eventData: ScheduledEventData,
  description: string,
  voiceChannelId: string | null,
): Promise<void> {
  await timedDiscordCall(
    'scheduledEvents.edit',
    () =>
      guild.scheduledEvents.edit(seId, {
        name: eventData.title,
        scheduledStartTime: new Date(eventData.startTime),
        scheduledEndTime: new Date(eventData.endTime),
        description,
        ...(voiceChannelId ? { channel: voiceChannelId } : {}),
      }),
    { eventId, op: 'update' },
  );
}
