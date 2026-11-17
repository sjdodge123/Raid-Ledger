/**
 * ROK-2227: edit one tracked embed and classify a failure as permanent or
 * transient.
 *
 * The embed-sync queue retries a job (`attempts: 3`, exponential backoff), but
 * only if the processor throws. A transient failure (network, 5xx, rate limit,
 * bot not ready) must therefore reach BullMQ. A message or channel that is gone,
 * or that the bot can no longer see, will fail identically on every retry, so
 * it is logged and dropped as before.
 */
import type { Logger } from '@nestjs/common';
import { DiscordAPIError } from 'discord.js';
import type * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  embedComponents,
  type DiscordEmbedFactory,
} from '../services/discord-embed.factory';
import { UNKNOWN_MESSAGE } from '../discord-bot-client.messages.helpers';
import {
  MISSING_ACCESS,
  MISSING_PERMISSIONS,
  UNKNOWN_CHANNEL,
} from '../channel-lifecycle/channel-lifecycle.errors';

/**
 * Discord codes no retry can fix: 10008, 10003, 50001, 50013. A permission
 * the bot lacks (50013) is not granted by waiting out a backoff.
 */
const PERMANENT_EDIT_CODES: ReadonlySet<number | string> = new Set([
  UNKNOWN_MESSAGE,
  UNKNOWN_CHANNEL,
  MISSING_ACCESS,
  MISSING_PERMISSIONS,
]);

/**
 * True when an embed edit failed because the message or channel is gone or
 * unreachable (Unknown Message, Unknown Channel, Missing Access, Missing
 * Permissions).
 *
 * The check is `instanceof DiscordAPIError`, not a duck-typed `code` read, the
 * same as `isUnknownMessage`; a test fakes the error with
 * `Object.create(DiscordAPIError.prototype)`.
 *
 * @param err - Anything thrown by `DiscordBotClientService.editEmbed`.
 */
export function isPermanentEmbedEditError(err: unknown): boolean {
  return err instanceof DiscordAPIError && PERMANENT_EDIT_CODES.has(err.code);
}

/** Collaborators `editTrackedEmbed` needs from the processor. */
export interface EmbedEditDeps {
  clientService: Pick<DiscordBotClientService, 'editEmbed'>;
  logger: Pick<Logger, 'warn'>;
}

/** The tracked message row an embed edit targets. */
type TrackedMessage = Pick<
  typeof schema.discordEventMessages.$inferSelect,
  'channelId' | 'messageId'
>;

/**
 * Outcome of one embed edit: `edited`, `gone` (permanent, dropped), or the
 * transient `Error` the job must rethrow so BullMQ retries it.
 */
export type EmbedEditOutcome = 'edited' | 'gone' | Error;

/**
 * Edit one tracked embed message and classify any failure (ROK-2227).
 *
 * @param deps - Discord client + logger.
 * @param record - The tracked message to edit.
 * @param built - The rebuilt embed payload.
 * @param eventId - The event being synced (for the log line).
 */
export async function editTrackedEmbed(
  deps: EmbedEditDeps,
  record: TrackedMessage,
  built: ReturnType<DiscordEmbedFactory['buildEventUpdate']>,
  eventId: number,
): Promise<EmbedEditOutcome> {
  try {
    await deps.clientService.editEmbed(
      record.channelId,
      record.messageId,
      built.embed,
      embedComponents(built),
      built.content,
    );
    return 'edited';
  } catch (err) {
    const gone = isPermanentEmbedEditError(err);
    deps.logger.warn(
      `Failed to sync embed in channel ${record.channelId} for event ` +
        `${eventId} (${gone ? 'gone, not retrying' : 'retrying'}): ` +
        `${err instanceof Error ? err.message : 'Unknown'}`,
    );
    if (gone) return 'gone';
    return err instanceof Error ? err : new Error(String(err));
  }
}
