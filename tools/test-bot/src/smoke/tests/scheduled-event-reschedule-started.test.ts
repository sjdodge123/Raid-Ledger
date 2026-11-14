/**
 * ROK-2201: moving the start of an event that has ALREADY STARTED to a later
 * time must end its ACTIVE Discord Scheduled Event and create a new one at the
 * new start. Discord refuses a start-time edit on an ACTIVE SE, so before the
 * fix the event kept its stale, live SE and the refusal was only logged.
 *
 * Flow: create an event starting a few minutes out (an SE is only created for
 * a future start), wait for the start cron to flip its SE to Active, PATCH the
 * start ~3 h later, then read Discord itself (never the DB) until the old SE
 * is Completed or gone AND a new SCHEDULED SE for the event sits at the new
 * start.
 *
 * Why no `/admin/test/set-event-times` back-dating: it is a DB-only write and
 * the start cron's ActiveEventCache gate keeps the creation-time start until
 * its next refresh, so a back-dated event does not start any sooner (see
 * suppression-end-sync.test.ts). The event starts for real instead.
 *
 * Deterministic polling only (helpers/polling.ts) — never a fixed delay.
 */
import { getGuild } from '../../client.js';
import { pollForCondition } from '../../helpers/polling.js';
import {
  awaitProcessing,
  createEvent,
  deleteEvent,
  futureTime,
} from '../fixtures.js';
import { SmokeAssertionError } from '../assert.js';
import {
  acquireScheduledEvents,
  releaseScheduledEvents,
  releaseScheduledEventsAndRethrow,
} from '../scheduled-events-toggle.js';
import {
  SE_STATUS,
  describeRescheduleState,
  findRecreatedSe,
  isEndedSeStatus,
  type SeSnapshot,
} from '../reschedule-started.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Minutes until the event starts. Creation skips an SE whose start is past. */
const START_IN_MIN = 3;
/** Cache gate opens at the real start, then the start cron ticks each minute. */
const ACTIVE_TIMEOUT_MS = (START_IN_MIN + 2) * 60_000;
/** The reschedule target: ~3 h out, well clear of the original window. */
const NEW_START_IN_MIN = 180;
const NEW_END_IN_MIN = 240;
/** Discord and Postgres may round differently; a minute is plenty. */
const START_TOLERANCE_MS = 60_000;

/** Every guild SE whose name contains the unique title (REST, not cache). */
async function listSesForTitle(title: string): Promise<SeSnapshot[]> {
  const events = await getGuild().scheduledEvents.fetch();
  return [...events.values()]
    .filter((se) => se.name.includes(title))
    .map((se) => ({
      id: se.id,
      name: se.name,
      status: se.status,
      startMs: se.scheduledStartTimestamp,
    }));
}

/** One SE's live status, forcing a REST round-trip; null when gone (10070). */
async function fetchSeStatus(seId: string): Promise<number | null> {
  try {
    const se = await getGuild().scheduledEvents.fetch({
      guildScheduledEvent: seId,
      force: true,
    });
    return se.status;
  } catch (err) {
    if ((err as { code?: unknown }).code === 10070) return null;
    throw err;
  }
}

async function waitForSeId(ctx: TestContext, title: string): Promise<string> {
  const found = await pollForCondition(
    async () => (await listSesForTitle(title))[0] ?? null,
    ctx.config.timeoutMs * 2,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new Error(`no Discord Scheduled Event appeared for "${title}"`);
  });
  return found.id;
}

/** Precondition: the start cron has flipped the SE to Active. */
async function waitForActive(seId: string): Promise<void> {
  let last: number | null = null;
  await pollForCondition(
    async () => {
      last = await fetchSeStatus(seId);
      return last === SE_STATUS.Active ? true : null;
    },
    ACTIVE_TIMEOUT_MS,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new Error(
      `precondition: SE ${seId} did not reach Active within ` +
        `${ACTIVE_TIMEOUT_MS}ms (last: ${describeRescheduleState(seId, last, [])})`,
    );
  });
}

/** The fix: old SE ended or gone AND a new Scheduled SE at the new start. */
async function assertEndedAndRecreated(
  ctx: TestContext,
  title: string,
  oldId: string,
  newStartMs: number,
): Promise<string> {
  let oldStatus: number | null = SE_STATUS.Active;
  let ses: SeSnapshot[] = [];
  const check = async (): Promise<string | null> => {
    oldStatus = await fetchSeStatus(oldId);
    ses = await listSesForTitle(title);
    const fresh = findRecreatedSe(ses, title, oldId, newStartMs, START_TOLERANCE_MS);
    return isEndedSeStatus(oldStatus) && fresh ? fresh.id : null;
  };
  return pollForCondition(check, ctx.config.timeoutMs, { intervalMs: 2000 })
    .catch(() => {
      throw new SmokeAssertionError(
        `ROK-2201: after moving started event "${title}" to ` +
          `${new Date(newStartMs).toISOString()}, expected old SE ${oldId} ` +
          `Completed/gone and a new Scheduled SE at the new start; ` +
          describeRescheduleState(oldId, oldStatus, ses),
      );
    });
}

/**
 * Product teardown first (the event delete removes the bound SE), then delete
 * any SE of ours still Scheduled/Active so the shared guild is not littered.
 * Never throws — cleanup must not replace the test's real failure.
 */
async function teardown(
  ctx: TestContext,
  eventId: number,
  title: string,
): Promise<void> {
  await deleteEvent(ctx.api, eventId).catch(() => undefined);
  await awaitProcessing(ctx.api).catch(() => undefined);
  const live = await listSesForTitle(title).catch(() => [] as SeSnapshot[]);
  for (const se of live.filter((s) => !isEndedSeStatus(s.status))) {
    console.warn(`  [ROK-2201] SE ${se.id} survived event delete; removing it`);
    await getGuild()
      .scheduledEvents.delete(se.id)
      .catch((err: unknown) => {
        console.warn(`  [ROK-2201] delete of SE ${se.id} failed: ${String(err)}`);
      });
  }
  await releaseScheduledEvents(ctx.api);
}

const rescheduleStartedEvent: SmokeTest = {
  name: 'ROK-2201: moving a started event later ends its Active SE and creates one at the new start',
  category: 'flow',
  async run(ctx) {
    await acquireScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-resched-started', {
      startTime: futureTime(START_IN_MIN),
      endTime: futureTime(START_IN_MIN + 60),
    }).catch(releaseScheduledEventsAndRethrow(ctx.api));
    try {
      await awaitProcessing(ctx.api);
      const oldId = await waitForSeId(ctx, ev.title);
      await waitForActive(oldId);
      const startTime = futureTime(NEW_START_IN_MIN);
      await ctx.api.patch(`/events/${ev.id}`, {
        startTime,
        endTime: futureTime(NEW_END_IN_MIN),
      });
      await awaitProcessing(ctx.api);
      await assertEndedAndRecreated(ctx, ev.title, oldId, Date.parse(startTime));
    } finally {
      await teardown(ctx, ev.id, ev.title);
    }
  },
};

export const scheduledEventRescheduleStartedTests: SmokeTest[] = [
  rescheduleStartedEvent,
];
