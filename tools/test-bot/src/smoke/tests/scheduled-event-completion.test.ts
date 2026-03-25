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
  enableScheduledEvents,
  disableScheduledEvents,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Reschedule an event to past times so it qualifies as a completion candidate. */
async function rescheduleToThePast(
  ctx: TestContext,
  eventId: number,
): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  await ctx.api.patch(`/events/${eventId}/reschedule`, {
    startTime: twoHoursAgo,
    endTime: oneHourAgo,
  });
}

/** Trigger the scheduled event completion cron via the test-only endpoint. */
async function triggerCompletion(ctx: TestContext): Promise<void> {
  await ctx.api.post('/admin/test/trigger-scheduled-event-completion', {});
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
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-create');
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
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const scheduledEventCompletedAfterCron: SmokeTest = {
  name: 'ROK-944: Scheduled Event transitions to Completed after completion cron',
  category: 'flow',
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-complete');
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

      // Trigger the completion cron
      await triggerCompletion(ctx);
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
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const completionCronSkipsFutureEvents: SmokeTest = {
  name: 'Completion cron does not complete events with future end times',
  category: 'flow',
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, 'se-future');
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
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const scheduledEventCompletionTests: SmokeTest[] = [
  scheduledEventCreatedOnEventCreate,
  scheduledEventCompletedAfterCron,
  completionCronSkipsFutureEvents,
];
