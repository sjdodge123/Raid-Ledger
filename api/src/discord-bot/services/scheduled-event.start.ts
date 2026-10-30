import type { Logger } from '@nestjs/common';
import { GuildScheduledEventStatus } from 'discord.js';
import { timedDiscordCall, formatApiError } from './scheduled-event.helpers';
import { isUnknownEventError } from './scheduled-event.discord-ops';
import { isActiveChannelConflictError } from './scheduled-event.channel-busy';
import type { DiscordBotClientService } from '../discord-bot-client.service';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

interface StartCandidate {
  id: number;
  discordScheduledEventId: string | null;
}

/**
 * `channelBusy` is set when Discord refused the start because another SE is
 * already Active in the voice channel (ROK-2053). The cron keeps retrying —
 * the channel frees when the other SE ends — but warns only once per SE.
 */
export interface StartOutcome {
  cleared: boolean;
  error?: unknown;
  channelBusy?: { channelId: string | null };
}

export async function tryStartEvent(
  guild: Guild,
  eventId: number,
  seId: string,
): Promise<StartOutcome> {
  let channelId: string | null = null;
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => guild.scheduledEvents.fetch(seId),
      { eventId },
    );
    if (se.status !== GuildScheduledEventStatus.Scheduled) {
      return { cleared: false };
    }
    channelId = se.channelId;

    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        guild.scheduledEvents.edit(seId, {
          status: GuildScheduledEventStatus.Active,
        }),
      { eventId, op: 'start' },
    );
    return { cleared: false };
  } catch (error) {
    return startFailure(error, channelId);
  }
}

function startFailure(error: unknown, channelId: string | null): StartOutcome {
  if (isUnknownEventError(error)) return { cleared: true };
  if (isActiveChannelConflictError(error)) {
    return { cleared: false, channelBusy: { channelId } };
  }
  return { cleared: false, error };
}

/** What the start cron needs to act on one candidate's outcome. */
export interface StartPassDeps {
  logger: Pick<Logger, 'warn' | 'error'>;
  /**
   * `${eventId}:${seId}` of SEs whose busy-channel refusal was already
   * warned about (ROK-2053) — dedupes the warning only, never the retry.
   */
  warned: Set<string>;
  clear: (eventId: number) => Promise<unknown>;
}

function warnKey(eventId: number, seId: string): string {
  return `${eventId}:${seId}`;
}

/**
 * Drop warning keys for SEs that are no longer start candidates (started,
 * past their end, rebound to a new SE id), so the set stays bounded.
 */
export function pruneStartWarnings(
  warned: Set<string>,
  candidates: readonly StartCandidate[],
): void {
  const live = new Set(
    candidates.flatMap((c) =>
      c.discordScheduledEventId
        ? [warnKey(c.id, c.discordScheduledEventId)]
        : [],
    ),
  );
  for (const key of warned) if (!live.has(key)) warned.delete(key);
}

/**
 * Start one candidate (ROK-573). A busy-channel refusal (ROK-2053) is
 * retried on every pass until the start window closes, but warned about
 * once per SE; if it never frees, the completion cron ends the SE via its
 * Canceled/delete fallback.
 */
export async function startCandidate(
  guild: Guild,
  c: StartCandidate,
  deps: StartPassDeps,
): Promise<void> {
  const seId = c.discordScheduledEventId;
  if (!seId) return;
  const key = warnKey(c.id, seId);
  const result = await tryStartEvent(guild, c.id, seId);
  if (result.channelBusy) {
    if (deps.warned.has(key)) return;
    deps.warned.add(key);
    deps.logger.warn(
      `Start SE ${seId} for event ${c.id} refused: voice channel ${result.channelBusy.channelId ?? 'unknown'} already has an Active scheduled event; retrying each pass until it frees or the event ends`,
    );
    return;
  }
  if (result.error) {
    deps.logger.error(formatApiError('start', c.id, result.error));
    return;
  }
  deps.warned.delete(key);
  if (result.cleared) await deps.clear(c.id);
}
