/**
 * ROK-1866 D2: a sync site that just flipped a connection to
 * `needs_reconnect` (read auth failure, write copy auth failure, write-off
 * auth failure) emits this AFTER its UPDATE committed. The notifications
 * listener claims the episode (`reconnect_nudged_at`) and sends the nudge,
 * so calendar-sync never depends on NotificationService.
 */
import { Logger } from '@nestjs/common';

export const CALENDAR_NEEDS_RECONNECT_EVENT = 'calendar.needs-reconnect';

export interface CalendarNeedsReconnectPayload {
  connectionId: number;
}

/** Minimal emitter shape so sites and specs need no Nest types. */
export interface CalendarReconnectEmitter {
  emit(event: string, payload: CalendarNeedsReconnectPayload): unknown;
}

const logger = new Logger('CalendarNeedsReconnect');

/** Best effort: an emit failure never fails the sync job. */
export function emitNeedsReconnect(
  emitter: CalendarReconnectEmitter | undefined,
  connectionId: number,
): void {
  if (!emitter) return;
  try {
    emitter.emit(CALENDAR_NEEDS_RECONNECT_EVENT, { connectionId });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    logger.warn(`needs-reconnect emit failed for ${connectionId} (${name})`);
  }
}
