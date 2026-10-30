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
 * already Active in the voice channel (ROK-2053) — retrying cannot succeed
 * while it stays Active, so the caller logs it once and stops retrying.
 */
export interface StartOutcome {
  cleared: boolean;
  error?: unknown;
  channelBusy?: { channelId: string | null };
}

export async function tryStartEvent(
  guild: Guild,
  candidate: StartCandidate,
): Promise<StartOutcome> {
  let channelId: string | null = null;
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => guild.scheduledEvents.fetch(candidate.discordScheduledEventId!),
      { eventId: candidate.id },
    );
    if (se.status !== GuildScheduledEventStatus.Scheduled) {
      return { cleared: false };
    }
    channelId = se.channelId;

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
  /** Events whose start Discord refused for a busy channel — never retried. */
  blocked: Set<number>;
  clear: (eventId: number) => Promise<unknown>;
}

/**
 * Start one candidate (ROK-573). A busy-channel refusal (ROK-2053) is logged
 * once with the event + channel and the event is not retried; the completion
 * cron later ends the SE via its Canceled/delete fallback.
 */
export async function startCandidate(
  guild: Guild,
  c: StartCandidate,
  deps: StartPassDeps,
): Promise<void> {
  if (deps.blocked.has(c.id)) return;
  const result = await tryStartEvent(guild, c);
  if (result.cleared) await deps.clear(c.id);
  else if (result.channelBusy) {
    deps.blocked.add(c.id);
    deps.logger.warn(
      `Start SE for event ${c.id} refused: voice channel ${result.channelBusy.channelId ?? 'unknown'} already has an Active scheduled event; not retrying`,
    );
  } else if (result.error) {
    deps.logger.error(formatApiError('start', c.id, result.error));
  }
}
