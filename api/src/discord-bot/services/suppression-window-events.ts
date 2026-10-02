/**
 * App events raised when a scheduled event's suppression window moves its
 * end time (ROK-1696).
 *
 * The suppression helpers stay free of service references: they only call
 * an optional hook, and AdHocEventService turns that hook into this event on
 * EventEmitter2. EventAutoExtendService owns every fan-out dependency and
 * listens for it.
 */
export const SUPPRESSION_WINDOW_EVENTS = {
  /** A suppressed Quick Play join wrote `extended_until` forward. */
  EXTENDED: 'event.suppression-window-extended',
} as const;

/** Payload for {@link SUPPRESSION_WINDOW_EVENTS.EXTENDED}. */
export interface SuppressionWindowExtendedPayload {
  /** The scheduled event whose window was extended. */
  eventId: number;
  /** The `extended_until` value that was written. */
  newEnd: Date;
  /** Discord scheduled event id, when one is linked. */
  discordScheduledEventId: string | null;
}
