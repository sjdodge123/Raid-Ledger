import { DiscordAPIError, GuildScheduledEventStatus } from 'discord.js';
import {
  timedDiscordCall,
  UNKNOWN_SCHEDULED_EVENT,
} from './scheduled-event.helpers';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { CompletionProgress } from './scheduled-event.discord-ops';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/**
 * Discord's nested form-error key for "another scheduled event is already
 * Active in this voice channel" (ROK-2053). It arrives under the generic
 * 50035 Invalid Form Body code, so 50035 alone says nothing.
 */
export const ACTIVE_STATUS_BY_CHANNEL_KEY =
  'GUILD_SCHEDULED_EVENT_INVALID_ACTIVE_STATUS_BY_CHANNEL';

function containsErrorKey(node: unknown, key: string): boolean {
  if (node === null || typeof node !== 'object') return false;
  if ((node as { code?: unknown }).code === key) return true;
  return Object.values(node).some((child) => containsErrorKey(child, key));
}

/**
 * True when Discord refused a Scheduled→Active edit because another SE is
 * already Active in the same voice channel. Matches the nested
 * `rawError.errors…_errors[].code`, or the flattened `field[CODE]: …` line
 * discord.js writes into `message` — never the bare 50035.
 */
export function isActiveChannelConflictError(error: unknown): boolean {
  if (!(error instanceof DiscordAPIError) || error.code !== 50035) return false;
  const raw: unknown = error.rawError;
  const errors =
    raw && typeof raw === 'object'
      ? (raw as { errors?: unknown }).errors
      : undefined;
  if (containsErrorKey(errors, ACTIVE_STATUS_BY_CHANNEL_KEY)) return true;
  return error.message.includes(`[${ACTIVE_STATUS_BY_CHANNEL_KEY}]`);
}

async function tryCancel(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<boolean> {
  try {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          status: GuildScheduledEventStatus.Canceled,
        }),
      { eventId, op: 'complete-cancel-channel-busy' },
    );
    return true;
  } catch {
    return false;
  }
}

async function tryDelete(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<boolean> {
  try {
    await timedDiscordCall(
      'scheduledEvents.delete',
      () => guild.scheduledEvents.delete(seId),
      { eventId, op: 'complete-delete-channel-busy' },
    );
    return true;
  } catch (error) {
    return (
      error instanceof DiscordAPIError && error.code === UNKNOWN_SCHEDULED_EVENT
    );
  }
}

/**
 * End a Scheduled SE that Discord would not activate because its channel is
 * busy (ROK-2053): Canceled first (Scheduled→Canceled is allowed), delete if
 * that fails. Re-throws `refusal` when neither works, so the caller still
 * sees the original error and the SE binding is kept for the next pass.
 */
export async function endChannelBlockedEvent(
  guild: Guild,
  eventId: number,
  seId: string,
  refusal: unknown,
  progress?: CompletionProgress,
): Promise<void> {
  if (await tryCancel(guild, eventId, seId)) {
    if (progress) {
      progress.to = GuildScheduledEventStatus.Canceled;
      progress.channelBusy = 'canceled';
    }
    return;
  }
  if (!(await tryDelete(guild, eventId, seId))) throw refusal;
  if (progress) {
    progress.to = null;
    progress.channelBusy = 'deleted';
  }
}
