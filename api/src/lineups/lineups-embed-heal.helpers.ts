/**
 * ROK-1370: embed healing for archive-time reschedule-poll clears.
 *
 * Lives in its own module (not lineups-lifecycle.helpers) so specs that
 * jest.mock the lifecycle helpers keep this factory intact.
 */
import type { Logger } from '@nestjs/common';
import type { EmbedSyncQueueService } from '../discord-bot/queues/embed-sync.queue';

/**
 * Build the `onEventsCleared` callback for `applyStatusUpdate`: enqueue an
 * embed re-sync per cleared event so a poll that expires (or a lineup aborted
 * mid-poll) doesn't leave the channel embed stuck on the RESCHEDULING card.
 * The SE itself is recreated by the reconciliation cron. Fire-and-forget;
 * queue absence (spec contexts) is a no-op.
 */
export function healClearedEventEmbeds(
  embedSyncQueue: EmbedSyncQueueService | undefined,
  logger: Logger,
): (eventIds: number[]) => void {
  return (eventIds) => {
    if (!embedSyncQueue) return;
    for (const eventId of eventIds) {
      embedSyncQueue
        .enqueue(eventId, 'reschedule-poll-cleared')
        .catch((err: unknown) =>
          logger.warn(
            `Embed heal enqueue failed for event ${eventId}: ${String(err)}`,
          ),
        );
    }
  };
}
