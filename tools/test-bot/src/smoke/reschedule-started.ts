/**
 * Pure decisions for the ROK-2201 smoke: rescheduling an event whose Discord
 * Scheduled Event is already ACTIVE to a later start must END the old SE
 * (Completed, or deleted when ending is refused) and create a NEW, SCHEDULED
 * SE at the new start.
 *
 * Pure on purpose (no discord.js import), like `ephemeral-leak.ts`, so
 * `reschedule-started.spec.ts` runs without a guild. The status numbers are
 * Discord's `GuildScheduledEventStatus` values.
 */

/** Discord's `GuildScheduledEventStatus` values. */
export const SE_STATUS = {
  Scheduled: 1,
  Active: 2,
  Completed: 3,
  Canceled: 4,
} as const;

const STATUS_NAMES: Record<number, string> = {
  1: 'Scheduled',
  2: 'Active',
  3: 'Completed',
  4: 'Canceled',
};

/** What the smoke reads off one guild Scheduled Event. */
export interface SeSnapshot {
  id: string;
  name: string;
  status: number;
  /** `scheduledStartTimestamp`; null when Discord returned none. */
  startMs: number | null;
}

/** True when the SE is over: gone (`null`, Discord 10070), Completed or Canceled. */
export function isEndedSeStatus(status: number | null): boolean {
  return (
    status === null ||
    status === SE_STATUS.Completed ||
    status === SE_STATUS.Canceled
  );
}

/**
 * The SE created for the rescheduled event: a different id from `oldId`, a
 * name containing the unique event `title`, status Scheduled, and a start
 * within `toleranceMs` of `expectedStartMs`. Null when there is none yet.
 */
export function findRecreatedSe(
  ses: readonly SeSnapshot[],
  title: string,
  oldId: string,
  expectedStartMs: number,
  toleranceMs: number,
): SeSnapshot | null {
  const hit = ses.find(
    (s) =>
      s.id !== oldId &&
      s.name.includes(title) &&
      s.status === SE_STATUS.Scheduled &&
      s.startMs !== null &&
      Math.abs(s.startMs - expectedStartMs) <= toleranceMs,
  );
  return hit ?? null;
}

function statusName(status: number | null): string {
  if (status === null) return 'gone';
  return STATUS_NAMES[status] ?? `status ${status}`;
}

function isoOrNone(ms: number | null): string {
  return ms === null ? 'no start' : new Date(ms).toISOString();
}

/**
 * One-line account of what Discord showed at the last read, for a failure
 * message that states the bug rather than "timed out".
 */
export function describeRescheduleState(
  oldId: string,
  oldStatus: number | null,
  ses: readonly SeSnapshot[],
): string {
  const listed = ses
    .map((s) => `${s.id} ${statusName(s.status)} @ ${isoOrNone(s.startMs)}`)
    .join(', ');
  return (
    `old SE ${oldId} is ${statusName(oldStatus)}; ` +
    `SEs for the event: ${listed.length > 0 ? listed : 'none'}`
  );
}
