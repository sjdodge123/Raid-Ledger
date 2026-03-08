import { GuildScheduledEventStatus, DiscordAPIError } from 'discord.js';
import {
  UNKNOWN_SCHEDULED_EVENT,
  timedDiscordCall,
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

export async function tryDeleteEvent(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<void> {
  try {
    await timedDiscordCall(
      'scheduledEvents.delete',
      () => guild.scheduledEvents.delete(seId),
      { eventId },
    );
  } catch (error) {
    if (!isUnknownEventError(error)) throw error;
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
