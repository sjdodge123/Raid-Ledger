import type { Logger } from '@nestjs/common';
import { isDiscordAccessError } from '../channel-lifecycle/channel-lifecycle.errors';
import {
  disconnectMember,
  type DisconnectResult,
} from './ephemeral-voice.discord-ops';
import type { DiscordBotClientService } from '../discord-bot-client.service';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/**
 * ROK-2119 — the join-guard's expected Discord refusals. A member the bot
 * cannot move (outranks it, or no Move Members) is not a bug: warn once per
 * (event, member) instead of sending a 50013 to Sentry on every join.
 */

/** Bound on remembered (event, member) pairs; the set resets past it. */
const MAX_WARNED = 1000;
const warned = new Set<string>();

/** Forget every warned pair (tests; the set also self-resets at its bound). */
export function clearJoinGuardWarnings(): void {
  warned.clear();
}

function warnOnce(
  logger: Pick<Logger, 'warn'>,
  eventId: number,
  memberId: string,
  why: string,
): void {
  const key = `${eventId}:${memberId}`;
  if (warned.has(key)) return;
  if (warned.size >= MAX_WARNED) warned.clear();
  warned.add(key);
  logger.warn(
    `Join-guard cannot disconnect ${memberId} from event ${eventId}'s private voice: ${why}`,
  );
}

/**
 * Disconnect a non-allow-listed member, treating "the bot cannot move them" —
 * the pre-check, or a 50013/50001 Discord returns anyway — as an expected
 * warning. Any other error is rethrown for the caller to capture.
 */
export async function guardDisconnect(
  guild: Guild,
  eventId: number,
  memberId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<DisconnectResult> {
  try {
    const res = await disconnectMember(guild, memberId);
    if (res === 'unmanageable') {
      warnOnce(
        logger,
        eventId,
        memberId,
        'member outranks the bot or it lacks Move Members',
      );
    }
    return res;
  } catch (err) {
    if (!isDiscordAccessError(err)) throw err;
    warnOnce(logger, eventId, memberId, `Discord refused (code ${err.code})`);
    return 'unmanageable';
  }
}
