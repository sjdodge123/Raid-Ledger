/**
 * ROK-1596 D3: enqueue helpers for the calendar write queue.
 *
 * Fixed job ids (`calendar-sync.constants.ts`). Three BullMQ behaviours shape
 * this file:
 * - an `add` whose id exists in ANY state is ignored. A retained finished
 *   (completed / failed) job would therefore block every later enqueue, so it
 *   is cleared first via the shared ROK-1762 `clearFinishedJob` guard;
 * - a pending (waiting / delayed) duplicate collapses — the job reconciles
 *   current state when it runs, so one run covers every trigger;
 * - an ACTIVE job may already have read the rows, so an update made mid-run
 *   would be lost. It gets exactly one `-rerun` follow-up instead;
 * - while that `-rerun` is live (pending or active) a new trigger collapses
 *   into it rather than re-adding the plain id, so two runs for one key never
 *   overlap (review m1). An update landing during an ACTIVE `-rerun` is
 *   picked up by the nightly reconcile cron (it scans the link rows).
 *
 * The kill switch drops `reconcile` jobs only; `write-off` and `disconnect`
 * are cleanup and always run (spec §8).
 */
import type { JobsOptions, Queue } from 'bullmq';
import { clearFinishedJob } from '../../queue/clear-finished-job.helpers';
import {
  WRITE_DEBOUNCE_MS,
  disconnectJobId,
  reconcileJobId,
  rerunJobId,
  writeOffJobId,
} from '../calendar-sync.constants';

export interface ReconcileJobData {
  kind: 'reconcile';
  connectionId: number;
  eventId: number;
  userId: number;
}

export interface WriteOffJobData {
  kind: 'write-off';
  connectionId: number;
}

export interface DisconnectJobData {
  kind: 'disconnect';
  connectionId: number;
}

/** Payloads carry ids only (epic §6.1). */
export type CalendarWriteJobData =
  ReconcileJobData | WriteOffJobData | DisconnectJobData;

export type CalendarWriteJobKind = CalendarWriteJobData['kind'];

/** The queue surface the helpers use — a real `Queue` or a test fake. */
export type CalendarWriteQueue = Pick<Queue, 'add' | 'getJob' | 'remove'>;

export interface CalendarWriteEnqueueDeps {
  queue: CalendarWriteQueue;
  /** Admin kill switch (`getCalendarSyncEnabled(settings)`). */
  isSyncEnabled: () => Promise<boolean>;
}

/** `added` = new job; `collapsed` = a pending job already covers it. */
export type EnqueueOutcome = 'added' | 'collapsed' | 'rerun' | 'dropped';

export interface EnqueueResult {
  outcome: EnqueueOutcome;
  /** The id added or collapsed into; null when dropped. */
  jobId: string | null;
}

export const CALENDAR_WRITE_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
} as const satisfies JobsOptions;

/** Cleanup kinds ignore the kill switch. */
export function isCleanupKind(kind: CalendarWriteJobKind): boolean {
  return kind === 'write-off' || kind === 'disconnect';
}

export function calendarWriteJobId(data: CalendarWriteJobData): string {
  if (data.kind === 'reconcile') {
    return reconcileJobId(data.connectionId, data.eventId, data.userId);
  }
  if (data.kind === 'write-off') return writeOffJobId(data.connectionId);
  return disconnectJobId(data.connectionId);
}

const PENDING_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/** A job holding this id will run (again) — a new add would be ignored. */
const isLive = (state: string) =>
  state === 'active' || PENDING_STATES.has(state);

async function addJob(
  queue: CalendarWriteQueue,
  data: CalendarWriteJobData,
  jobId: string,
): Promise<void> {
  const delay = data.kind === 'reconcile' ? WRITE_DEBOUNCE_MS : 0;
  await queue.add(data.kind, data, {
    ...CALENDAR_WRITE_JOB_OPTIONS,
    jobId,
    delay,
  });
}

/** The plain-id job is running: queue (at most) one follow-up. */
async function addRerun(
  queue: CalendarWriteQueue,
  data: CalendarWriteJobData,
  jobId: string,
): Promise<EnqueueResult> {
  const rerunId = rerunJobId(jobId);
  const state = await clearFinishedJob(queue, rerunId);
  if (isLive(state)) return { outcome: 'collapsed', jobId: rerunId };
  await addJob(queue, data, rerunId);
  return { outcome: 'rerun', jobId: rerunId };
}

/** Enqueue one write-queue job (see file header for the rules). */
export async function enqueueCalendarWriteJob(
  deps: CalendarWriteEnqueueDeps,
  data: CalendarWriteJobData,
): Promise<EnqueueResult> {
  if (!isCleanupKind(data.kind) && !(await deps.isSyncEnabled())) {
    return { outcome: 'dropped', jobId: null };
  }
  const jobId = calendarWriteJobId(data);
  const state = await clearFinishedJob(deps.queue, jobId);
  if (state === 'active') return addRerun(deps.queue, data, jobId);
  if (PENDING_STATES.has(state)) return { outcome: 'collapsed', jobId };
  // A live `-rerun` already covers this key: a plain job now could run
  // alongside it (review m1).
  const rerunId = rerunJobId(jobId);
  const rerunState = await clearFinishedJob(deps.queue, rerunId);
  if (isLive(rerunState)) return { outcome: 'collapsed', jobId: rerunId };
  await addJob(deps.queue, data, jobId);
  return { outcome: 'added', jobId };
}
