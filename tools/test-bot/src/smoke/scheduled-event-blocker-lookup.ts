/**
 * Failure-path lookup for the SE smoke tests: read the guild's Scheduled
 * Events once and describe a foreign Active event on the voice channel of the
 * test's own event (see scheduled-event-blocker.ts for why). Kept apart from
 * the pure helpers so their spec needs no Discord client.
 */
import { getGuild } from '../client.js';
import {
  describeBlockingEvent,
  findOwnChannelBlocker,
} from './scheduled-event-blocker.js';

/**
 * `"; <description>"` when a foreign event is Active on our event's channel,
 * else `""`. Never throws: a failed fetch yields `""`, so the caller's
 * original failure message is never masked.
 */
export async function blockerSuffixFor(ownSeId: string): Promise<string> {
  try {
    const events = await getGuild().scheduledEvents.fetch();
    const found = findOwnChannelBlocker(events.values(), ownSeId);
    if (!found) return '';
    return `; ${describeBlockingEvent(found.blocker, found.channelId)}`;
  } catch {
    return '';
  }
}
