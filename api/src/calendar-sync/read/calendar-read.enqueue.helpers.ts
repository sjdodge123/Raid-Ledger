/**
 * ROK-1593 D-R5: enqueue helpers for the calendar read queue. Same rules as
 * the write queue (`write/calendar-write.enqueue.helpers.ts`, ROK-1596 D3):
 * - a retained finished (completed / failed) job with the fixed id would make
 *   BullMQ ignore every later `add`, so it is cleared first (ROK-1762,
 *   `clearFinishedJob`);
 * - a pending duplicate collapses — the job re-reads the provider, so one run
 *   covers every trigger;
 * - an ACTIVE job may already have fetched, so it gets exactly one `-rerun`;
 *   while that `-rerun` is live a new trigger collapses into it.
 *
 * The kill switch drops `sync` adds. Its purge (D10) is a request-path
 * delete (`calendar-read-purge.helpers.ts`), not a job.
 */
import type { JobsOptions, Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { clearFinishedJob } from '../../queue/clear-finished-job.helpers';
import {
  deriveJobId,
  readSyncJobId,
  rerunJobId,
} from '../calendar-sync.constants';
import type { EnqueueResult } from '../write/calendar-write.enqueue.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface ReadSyncJobData {
  kind: 'sync';
  connectionId: number;
}

/** PR-B (D9): rebuild one user's synced away days from their blocks. */
export interface ReadDeriveJobData {
  kind: 'derive';
  userId: number;
}

/** Payloads carry ids only (epic §6.1). */
export type CalendarReadJobData = ReadSyncJobData | ReadDeriveJobData;

export type CalendarReadQueue = Pick<Queue, 'add' | 'getJob' | 'remove'>;

export interface CalendarReadEnqueueDeps {
  queue: CalendarReadQueue;
  /** Admin kill switch (`getCalendarSyncEnabled(settings)`). */
  isSyncEnabled: () => Promise<boolean>;
}

/**
 * The statuses a sync may run for (D7). A transient read failure leaves the
 * row `active` and only pushes `next_sync_at` out (D5 backoff), so there is
 * no `error` status to re-pick.
 */
export const READ_SYNCABLE_STATUSES = ['active'] as const;

export const CALENDAR_READ_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
  // Bounded: failed jobs stay inspectable; `clearFinishedJob` keeps a
  // retained one from blocking the next add.
  removeOnFail: 100,
} as const satisfies JobsOptions;

const PENDING_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

const isLive = (state: string) =>
  state === 'active' || PENDING_STATES.has(state);

async function addJob(
  queue: CalendarReadQueue,
  data: CalendarReadJobData,
  jobId: string,
): Promise<void> {
  await queue.add(data.kind, data, { ...CALENDAR_READ_JOB_OPTIONS, jobId });
}

/**
 * The plain-id job is running: queue (at most) one follow-up.
 *
 * Known, accepted overlap: the `-rerun` id differs from the active job's, so
 * a worker may start it while the older job is still fetching, and the
 * older fetch can commit LAST (its blocks win). Low impact — both fetches
 * are recent, and the next sync (≤ 30 min) replaces the blocks again.
 */
async function addRerun(
  queue: CalendarReadQueue,
  data: CalendarReadJobData,
  jobId: string,
): Promise<EnqueueResult> {
  const rerunId = rerunJobId(jobId);
  const state = await clearFinishedJob(queue, rerunId);
  if (isLive(state)) return { outcome: 'collapsed', jobId: rerunId };
  await addJob(queue, data, rerunId);
  return { outcome: 'rerun', jobId: rerunId };
}

/** Dedup by fixed id (rules in the file header), shared by every kind. */
async function enqueueDeduped(
  queue: CalendarReadQueue,
  data: CalendarReadJobData,
  jobId: string,
): Promise<EnqueueResult> {
  const state = await clearFinishedJob(queue, jobId);
  if (state === 'active') return addRerun(queue, data, jobId);
  if (PENDING_STATES.has(state)) return { outcome: 'collapsed', jobId };
  const rerunId = rerunJobId(jobId);
  const rerunState = await clearFinishedJob(queue, rerunId);
  if (isLive(rerunState)) return { outcome: 'collapsed', jobId: rerunId };
  await addJob(queue, data, jobId);
  return { outcome: 'added', jobId };
}

/** Enqueue one read sync for a connection (rules in the file header). */
export async function enqueueCalendarReadSync(
  deps: CalendarReadEnqueueDeps,
  connectionId: number,
): Promise<EnqueueResult> {
  if (!(await deps.isSyncEnabled())) return { outcome: 'dropped', jobId: null };
  const data: ReadSyncJobData = { kind: 'sync', connectionId };
  return enqueueDeduped(deps.queue, data, readSyncJobId(connectionId));
}

/**
 * PR-B (D9): enqueue one away-day derive for a user (Ignore, template save,
 * disconnect). Same dedup as a sync, keyed `cal-derive-<user>`. Not gated on
 * the kill switch: a derive only reads stored blocks, and the purge (D10)
 * has already removed them when the switch is off.
 */
export function enqueueCalendarDerive(
  queue: CalendarReadQueue,
  userId: number,
): Promise<EnqueueResult> {
  const data: ReadDeriveJobData = { kind: 'derive', userId };
  return enqueueDeduped(queue, data, deriveJobId(userId));
}

/** Enqueue each id in turn; returns the outcomes in order. */
export async function enqueueCalendarReadSyncs(
  deps: CalendarReadEnqueueDeps,
  connectionIds: readonly number[],
): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = [];
  for (const id of connectionIds) {
    results.push(await enqueueCalendarReadSync(deps, id));
  }
  return results;
}

/** D10 kill switch on: a sync for every read connection that can run. */
export async function enqueueAllReadSyncs(
  db: Db,
  deps: CalendarReadEnqueueDeps,
): Promise<EnqueueResult[]> {
  const c = schema.calendarConnections;
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.readEnabled, true),
        inArray(c.status, [...READ_SYNCABLE_STATUSES]),
      ),
    );
  return enqueueCalendarReadSyncs(
    deps,
    rows.map((r) => r.id),
  );
}
