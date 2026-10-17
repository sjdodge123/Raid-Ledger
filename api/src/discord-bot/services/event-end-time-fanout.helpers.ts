import type { Logger } from '@nestjs/common';
import type { ActiveEventCacheService } from '../../events/active-event-cache.service';
import type { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import type { AdHocNotificationService } from './ad-hoc-notification.service';
import type { ScheduledEventService } from './scheduled-event.service';

/** Collaborators the end-time fan-out pushes a new end to. */
export interface EndTimeFanOutDeps {
  eventCache: ActiveEventCacheService | null;
  adHocGateway: AdHocEventsGateway;
  adHocNotificationService: AdHocNotificationService;
  scheduledEventService: ScheduledEventService;
  logger: Logger;
}

/** The event whose effective end moved. */
export interface EndTimeFanOutTarget {
  id: number;
  isAdHoc: boolean;
  channelBindingId: string | null;
  discordScheduledEventId: string | null;
}

/**
 * Push an already-persisted `extended_until` to every consumer: the active
 * event cache, web clients, the ad-hoc embed (ad-hoc events only) and the
 * Discord scheduled event. Network side effects are fire-and-forget; their
 * failures are logged, never thrown.
 *
 * Shared by the auto-extend cron and the suppression-window listener so
 * both paths stay in step (ROK-1696).
 */
export function fanOutEndTimeExtension(
  deps: EndTimeFanOutDeps,
  target: EndTimeFanOutTarget,
  newEnd: Date,
): void {
  deps.eventCache?.invalidate(target.id);
  deps.eventCache
    ?.refresh()
    .catch((e) => deps.logger.warn(`Cache refresh after extend failed: ${e}`));
  deps.adHocGateway.emitEndTimeExtended(target.id, newEnd.toISOString());
  if (target.isAdHoc && target.channelBindingId)
    deps.adHocNotificationService.queueUpdate(
      target.id,
      target.channelBindingId,
    );
  if (target.discordScheduledEventId) {
    deps.scheduledEventService
      .updateEndTime(target.id, newEnd)
      .catch((err: unknown) => {
        deps.logger.warn(
          `Failed to update scheduled event end time for ${target.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      });
  }
}
