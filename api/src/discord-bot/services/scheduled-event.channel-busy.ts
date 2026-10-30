import type { Logger } from '@nestjs/common';
import { DiscordAPIError, GuildScheduledEventStatus } from 'discord.js';
import {
  INVALID_FORM_BODY,
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
  if (!(error instanceof DiscordAPIError) || error.code !== INVALID_FORM_BODY)
    return false;
  const raw: unknown = error.rawError;
  const errors =
    raw && typeof raw === 'object'
      ? (raw as { errors?: unknown }).errors
      : undefined;
  if (containsErrorKey(errors, ACTIVE_STATUS_BY_CHANNEL_KEY)) return true;
  return error.message.includes(`[${ACTIVE_STATUS_BY_CHANNEL_KEY}]`);
}

/** The SE a busy voice channel kept from going Active, and who to tell. */
export interface BlockedSE {
  eventId: number;
  seId: string;
  channelId: string | null;
  logger?: Pick<Logger, 'warn'>;
}

function reasonOf(error: unknown): string {
  if (error instanceof DiscordAPIError) return `${error.code} ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Resolves to `null` on success, or the error the Canceled edit hit. */
async function tryCancel(guild: Guild, se: BlockedSE): Promise<unknown> {
  try {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(se.seId, {
          status: GuildScheduledEventStatus.Canceled,
        }),
      { eventId: se.eventId, op: 'complete-cancel-channel-busy' },
    );
    return null;
  } catch (error) {
    return error ?? new Error('cancel failed');
  }
}

/** Resolves to `null` when the SE is gone (deleted or 10070), else the error. */
async function tryDelete(guild: Guild, se: BlockedSE): Promise<unknown> {
  try {
    await timedDiscordCall(
      'scheduledEvents.delete',
      () => guild.scheduledEvents.delete(se.seId),
      { eventId: se.eventId, op: 'complete-delete-channel-busy' },
    );
    return null;
  } catch (error) {
    const gone =
      error instanceof DiscordAPIError &&
      error.code === UNKNOWN_SCHEDULED_EVENT;
    return gone ? null : (error ?? new Error('delete failed'));
  }
}

function warnBlocked(se: BlockedSE, what: string): void {
  se.logger?.warn(
    `Complete SE ${se.seId} for event ${se.eventId}: voice channel ${se.channelId ?? 'unknown'} already has an Active scheduled event; ${what}`,
  );
}

/**
 * End a Scheduled SE that Discord would not activate because its channel is
 * busy (ROK-2053): Canceled first (Scheduled→Canceled is allowed), delete if
 * that fails, and warn which fallback ran. Re-throws `refusal` when neither
 * works, so the caller still sees the original error and the SE binding is
 * kept for the next pass.
 */
export async function endChannelBlockedEvent(
  guild: Guild,
  se: BlockedSE,
  refusal: unknown,
  progress?: CompletionProgress,
): Promise<void> {
  const cancelError = await tryCancel(guild, se);
  if (cancelError === null) {
    warnBlocked(se, 'fallback: canceled instead of completed');
    if (progress) {
      progress.to = GuildScheduledEventStatus.Canceled;
      progress.channelBusy = 'canceled';
    }
    return;
  }
  const cancelWhy = `cancel failed (${reasonOf(cancelError)})`;
  const deleteError = await tryDelete(guild, se);
  if (deleteError !== null) {
    warnBlocked(se, `${cancelWhy}; delete failed (${reasonOf(deleteError)})`);
    throw refusal;
  }
  warnBlocked(se, `${cancelWhy}; fallback: deleted instead of completed`);
  if (progress) {
    progress.to = null;
    progress.channelBusy = 'deleted';
  }
}
