/**
 * Scheduled Event Completion smoke tests (ROK-944).
 *
 * Validates the end-to-end flow for Discord scheduled event cleanup:
 * 1. Create an event (API creates a Discord Scheduled Event)
 * 2. Verify the Scheduled Event exists in the guild
 * 3. Reschedule the event to past times (makes it a completion candidate)
 * 4. Trigger the completion cron via the test-only endpoint
 * 5. Verify the Discord Scheduled Event transitions to Completed status
 */
import { GuildScheduledEventStatus } from 'discord.js';
import { getGuild } from '../../client.js';
import { pollForCondition } from '../../helpers/polling.js';
import {
  createEvent,
  deleteEvent,
  awaitProcessing,
  flushEmbedQueue,
} from '../fixtures.js';
import {
  acquireScheduledEvents,
  releaseScheduledEvents,
  releaseScheduledEventsAndRethrow,
} from '../scheduled-events-toggle.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Force-set event times to the past via test endpoint (bypasses Zod validation). */
async function rescheduleToThePast(
  ctx: TestContext,
  eventId: number,
): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  await ctx.api.post('/admin/test/set-event-times', {
    eventId,
    startTime: twoHoursAgo,
    endTime: oneHourAgo,
  });
}

/** One event's completion outcome from the trigger endpoint (ROK-944). */
interface SECompletionOutcome {
  eventId: number;
  discordEventId: string | null;
  from: string | null;
  to: string | null;
  ok: boolean;
  errorCode?: number | string;
  errorMessage?: string;
}

/** Trigger endpoint response — `outcomes`/`reason` are additive (ROK-944). */
interface SECompletionTriggerResult {
  success: boolean;
  outcomes?: SECompletionOutcome[];
  reason?: string;
}

/** Trigger the scheduled event completion cron via the test-only endpoint. */
async function triggerCompletion(
  ctx: TestContext,
): Promise<SECompletionTriggerResult> {
  return ctx.api.post<SECompletionTriggerResult>(
    '/admin/test/trigger-scheduled-event-completion',
    {},
  );
}

/**
 * Status of the captured Discord Scheduled Event, read by id via the bot's
 * Discord API (HTTP, not cache). `null` = Discord no longer has it (10070),
 * which the final check below also treats as completed-and-cleaned-up.
 */
async function fetchScheduledEventStatus(
  seId: string,
): Promise<GuildScheduledEventStatus | null> {
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

/**
 * Fail loudly — naming the Discord error code/message — when the completion
 * pass did not complete THIS event (ROK-944: the pool-0 failure was a silent
 * poll timeout because the trigger always said success). No outcome for our
 * event is accepted only when the background cron already completed it
 * between the reschedule and the trigger (it then has no Discord binding, so
 * the pass's candidate query skips it).
 */
async function assertOwnOutcomeOk(
  result: SECompletionTriggerResult,
  eventId: number,
  seId: string,
): Promise<void> {
  const own = result.outcomes?.find((o) => o.eventId === eventId);
  if (!own) {
    const status = await fetchScheduledEventStatus(seId);
    if (status === null || status === GuildScheduledEventStatus.Completed) {
      return;
    }
    throw new Error(
      `ROK-944: completion pass did not reach event ${eventId} and SE ${seId} ` +
        `is ${GuildScheduledEventStatus[status]}, not Completed ` +
        `(reason=${result.reason ?? 'none'}, success=${result.success}, ` +
        `outcomes=${JSON.stringify(result.outcomes ?? [])})`,
    );
  }
  if (!own.ok) {
    throw new Error(
      `ROK-944: completing event ${eventId} (SE ${own.discordEventId ?? 'none'}) ` +
        `failed ${own.from ?? '?'} -> ${own.to ?? '?'}: ` +
        `code=${own.errorCode ?? 'none'} message=${own.errorMessage ?? 'none'}`,
    );
  }
}

/**
 * Find a Discord Scheduled Event in the guild by title substring.
 * Uses HTTP fetch (not cache) so it works without the GuildScheduledEvents intent.
 */
async function findScheduledEventByTitle(
  title: string,
): Promise<{ id: string; status: GuildScheduledEventStatus } | null> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  const match = events.find((se) => se.name.includes(title));
  if (!match) return null;
  return { id: match.id, status: match.status };
}

const scheduledEventCreatedOnEventCreate: SmokeTest = {
  name: 'Discord Scheduled Event is created when an event is created',
  category: 'flow',
  async run(ctx) {
    await acquireScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-create').catch(
      releaseScheduledEventsAndRethrow(ctx.api),
    );
    try {
      await awaitProcessing(ctx.api);
      // Poll for the Discord scheduled event to appear in the guild
      const se = await pollForCondition(
        () => findScheduledEventByTitle(ev.title),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
      if (se.status !== GuildScheduledEventStatus.Scheduled) {
        throw new Error(
          `Expected Scheduled status, got ${GuildScheduledEventStatus[se.status]}`,
        );
      }
    } finally {
      await releaseScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const scheduledEventCompletedAfterCron: SmokeTest = {
  name: 'ROK-944: Scheduled Event transitions to Completed after completion cron',
  category: 'flow',
  async run(ctx) {
    await acquireScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-complete').catch(
      releaseScheduledEventsAndRethrow(ctx.api),
    );
    try {
      await awaitProcessing(ctx.api);
      // Wait for the Discord scheduled event to appear
      const created = await pollForCondition(
        () => findScheduledEventByTitle(ev.title),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
      if (!created) throw new Error('Scheduled event was not created');

      // Move the event times to the past so it becomes a completion candidate
      await rescheduleToThePast(ctx, ev.id);
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      // Trigger the completion cron; its own outcome must be ok (ROK-944)
      const result = await triggerCompletion(ctx);
      await assertOwnOutcomeOk(result, ev.id, created.id);
      await awaitProcessing(ctx.api);

      // Poll for the scheduled event to reach Completed status or be removed.
      // The completion cron calls activateAndComplete which transitions
      // Scheduled -> Active -> Completed, then clears discordScheduledEventId.
      // After completion, Discord keeps the event in Completed status briefly
      // before it disappears from fetch results.
      await pollForCondition(
        async () => {
          const current = await findScheduledEventByTitle(ev.title);
          // Event removed from guild = completion succeeded and Discord cleaned up
          if (!current) return true;
          // Event reached Completed status = completion succeeded
          if (current.status === GuildScheduledEventStatus.Completed) return true;
          return null; // keep polling
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
    } finally {
      await releaseScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const completionCronSkipsFutureEvents: SmokeTest = {
  name: 'Completion cron does not complete events with future end times',
  category: 'flow',
  async run(ctx) {
    await acquireScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-future').catch(
      releaseScheduledEventsAndRethrow(ctx.api),
    );
    try {
      await awaitProcessing(ctx.api);
      // Wait for the Discord scheduled event to appear
      const created = await pollForCondition(
        () => findScheduledEventByTitle(ev.title),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
      if (!created) throw new Error('Scheduled event was not created');

      // Trigger the completion cron -- this event has future times, should NOT complete
      await triggerCompletion(ctx);
      await awaitProcessing(ctx.api);

      // Verify the scheduled event is still in Scheduled status
      const after = await findScheduledEventByTitle(ev.title);
      if (!after) {
        throw new Error(
          'Scheduled event disappeared after completion cron (should still exist)',
        );
      }
      if (after.status !== GuildScheduledEventStatus.Scheduled) {
        throw new Error(
          `Expected Scheduled status after cron, got ${GuildScheduledEventStatus[after.status]}`,
        );
      }
    } finally {
      await releaseScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const scheduledEventCompletionTests: SmokeTest[] = [
  scheduledEventCreatedOnEventCreate,
  scheduledEventCompletedAfterCron,
  completionCronSkipsFutureEvents,
];
