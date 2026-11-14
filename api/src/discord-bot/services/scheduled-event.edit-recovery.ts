/**
 * Recovery for a full SE edit that Discord refused (ROK-2201).
 *
 * Discord rejects a start-time edit on an ACTIVE Scheduled Event, so an event
 * that already started and is then moved later used to keep its stale SE and
 * the failure was only logged as a generic "Failed to update". The ruling:
 * an ACTIVE SE whose new start is later than now is ENDED (Completed, or
 * deleted when ending is refused) and a new SE is created at the new start.
 * An SE that is gone (10070) or already over is recreated; anything else is
 * logged with its Discord error code and SE status — never silently dropped.
 */
import type { Logger } from '@nestjs/common';
import { GuildScheduledEventStatus } from 'discord.js';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  timedDiscordCall,
  type ScheduledEventData,
} from './scheduled-event.helpers';
import {
  discordErrorCode,
  isTerminalStatus,
  isUnknownEventError,
  tryDeleteEvent,
} from './scheduled-event.discord-ops';
import { parseEventTimestampUtc } from './scheduled-event.revalidate';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/** The refused edit and what recovery needs to act on it. */
export interface RejectedEdit {
  guild: Guild;
  eventId: number;
  seId: string;
  eventData: ScheduledEventData;
  logger: Pick<Logger, 'warn' | 'error'>;
  /** Clock override for tests; defaults to the current time. */
  now?: Date;
}

/** What to do with the stored SE after Discord refused the edit. */
export type EditRecovery = 'recreate' | 'end-then-recreate' | 'log';

/** Live SE status, or `'gone'` when Discord no longer has it (10070). */
type SEState = GuildScheduledEventStatus | 'gone';

/**
 * Decide the recovery for a refused edit from the SE's live state and whether
 * the event's (new) start is still ahead. Pure — exported for unit tests.
 */
export function planEditRecovery(
  state: SEState,
  startsLater: boolean,
): EditRecovery {
  if (state === 'gone') return 'recreate';
  if (!startsLater) return 'log';
  if (state === GuildScheduledEventStatus.Active) return 'end-then-recreate';
  return isTerminalStatus(state) ? 'recreate' : 'log';
}

async function fetchSEState(r: RejectedEdit): Promise<SEState> {
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => r.guild.scheduledEvents.fetch(r.seId),
      { eventId: r.eventId, op: 'update-recover' },
    );
    return se.status;
  } catch (error) {
    if (isUnknownEventError(error)) return 'gone';
    throw error;
  }
}

function codeOf(error: unknown): string {
  return String(discordErrorCode(error) ?? 'unknown');
}

function logRejected(r: RejectedEdit, error: unknown, detail: string): void {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  r.logger.error(
    `Update SE ${r.seId} for event ${r.eventId} rejected: code=${codeOf(error)} ${detail} (${msg}) — SE left unchanged`,
  );
}

/** End an ACTIVE SE: Completed first, delete as the fallback. True when over. */
async function endActiveSE(r: RejectedEdit): Promise<boolean> {
  try {
    await timedDiscordCall(
      'scheduledEvents.edit',
      () =>
        r.guild.scheduledEvents.edit(r.seId, {
          status: GuildScheduledEventStatus.Completed,
        }),
      { eventId: r.eventId, op: 'reschedule-end' },
    );
    return true;
  } catch (error) {
    if (isUnknownEventError(error)) return true;
    const outcome = await tryDeleteEvent(r.guild, r.eventId, r.seId);
    if (!outcome.deleted) {
      r.logger.error(
        `Reschedule of started event ${r.eventId}: could not end SE ${r.seId} (code=${codeOf(error)}) or delete it (code=${outcome.code ?? 'unknown'})`,
      );
    }
    return outcome.deleted;
  }
}

/**
 * Handle a refused full edit of SE `r.seId`. `recreate` must clear the stored
 * SE id and create a fresh SE through the normal create path.
 */
export async function recoverRejectedEdit(
  r: RejectedEdit,
  error: unknown,
  recreate: () => Promise<void>,
): Promise<void> {
  if (isUnknownEventError(error)) return recreate();
  let state: SEState;
  try {
    state = await fetchSEState(r);
  } catch (fetchError) {
    logRejected(r, error, `status=unknown (fetch code=${codeOf(fetchError)})`);
    return;
  }
  const start = parseEventTimestampUtc(r.eventData.startTime);
  const startsLater = start.getTime() > (r.now ?? new Date()).getTime();
  const action = planEditRecovery(state, startsLater);
  if (action === 'log') {
    const label = state === 'gone' ? 'gone' : GuildScheduledEventStatus[state];
    logRejected(r, error, `status=${label}`);
    return;
  }
  if (action === 'end-then-recreate' && !(await endActiveSE(r))) return;
  r.logger.warn(
    `Update SE ${r.seId} for event ${r.eventId} rejected (code=${codeOf(error)}); ${action} at the new start`,
  );
  await recreate();
}
