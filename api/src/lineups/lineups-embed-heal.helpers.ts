/**
 * ROK-1370: embed healing for archive-time reschedule-poll clears.
 * ROK-1857: also emits APP_EVENT_EVENTS.RESCHEDULE_CLEARED per cleared event
 * so the calendar write path restores the members' Google copies.
 *
 * Lives in its own module (not lineups-lifecycle.helpers) so specs that
 * jest.mock the lifecycle helpers keep this factory intact.
 */
import type { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import type { EmbedSyncQueueService } from '../discord-bot/queues/embed-sync.queue';

/**
 * Build the `onEventsCleared` callback for `applyStatusUpdate`: enqueue an
 * embed re-sync per cleared event so a poll that expires (or a lineup aborted
 * mid-poll) doesn't leave the channel embed stuck on the RESCHEDULING card.
 * The SE itself is recreated by the reconciliation cron. Fire-and-forget;
 * queue / emitter absence (spec contexts) is a no-op. The emit is a plain
 * `emit` — its only consumer (CalendarWriteListener) is async and never throws.
 */
export function healClearedEventEmbeds(
  embedSyncQueue: EmbedSyncQueueService | undefined,
  logger: Logger,
  eventEmitter?: EventEmitter2,
): (eventIds: number[]) => void {
  return (eventIds) => {
    for (const eventId of eventIds) {
      embedSyncQueue
        ?.enqueue(eventId, 'reschedule-poll-cleared')
        .catch((err: unknown) =>
          logger.warn(
            `Embed heal enqueue failed for event ${eventId}: ${String(err)}`,
          ),
        );
      eventEmitter?.emit(APP_EVENT_EVENTS.RESCHEDULE_CLEARED, { eventId });
    }
  };
}
