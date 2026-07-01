/**
 * ROK-1370 — Reschedule-poll start suppression + lock-in restore (Option A).
 *
 * Cancel-to-poll rescheduling opens a scheduling poll linked to an event, then
 * (on lock-in) moves the event in place to the winning time. This suite proves
 * the Discord-facing half end-to-end:
 *
 *   1. Poll start → the linked event's channel embed flips to the amber
 *      RESCHEDULING card AND its Discord Scheduled Event is torn down.
 *   2. Lock-in (reschedule in place → complete the poll) → the embed refreshes
 *      back to the live POSTED card at the new time AND the Scheduled Event is
 *      recreated.
 *   3. The whole cycle repeats — a second poll+lock-in works identically.
 *
 * The SE is recreated by the existing `event.updated → updateScheduledEvent`
 * path (a cleared SE id routes to the create branch) fired by the in-place
 * reschedule; the poll-complete re-emit resets the stuck embed to POSTED.
 *
 * Uses only deterministic wait helpers (pollForEmbed / waitForEmbedUpdate /
 * pollForCondition) — never fixed timers.
 */
import { GuildScheduledEventStatus } from 'discord.js';
import { getGuild } from '../../client.js';
import {
  pollForEmbed,
  waitForEmbedUpdate,
  pollForCondition,
} from '../../helpers/polling.js';
import {
  createEvent,
  rescheduleEvent,
  deleteEvent,
  awaitProcessing,
  flushEmbedQueue,
  channelForTest,
  enableScheduledEvents,
  disableScheduledEvents,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface CreatePollResponse {
  id: number;
  lineupId: number;
  gameId: number;
}

/** Resolve a configured gameId for the poll (MMO binding → /games/configured). */
async function resolveGameId(ctx: TestContext): Promise<number> {
  const fromCtx = ctx.games[0]?.id ?? ctx.mmoGameId;
  if (fromCtx) return fromCtx;
  const res = await ctx.api.get<{ data: { id: number }[] }>('/games/configured');
  const id = res?.data?.[0]?.id;
  if (!id) throw new Error('Need at least one configured game for the poll');
  return id;
}

/** Fetch a guild Scheduled Event by title substring (HTTP, not cache). */
async function findScheduledEventByTitle(
  title: string,
): Promise<{ id: string; status: GuildScheduledEventStatus } | null> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  const match = events.find((se) => se.name.includes(title));
  return match ? { id: match.id, status: match.status } : null;
}

/** Open a reschedule poll linked to the event. */
function openReschedulePoll(
  api: ApiClient,
  gameId: number,
  linkedEventId: number,
): Promise<CreatePollResponse> {
  return api.post<CreatePollResponse>('/scheduling-polls', {
    gameId,
    linkedEventId,
  });
}

/** Lock the poll in: move the event in place, then complete the poll. */
async function lockIn(
  ctx: TestContext,
  eventId: number,
  matchId: number,
  minutesFromNow: number,
): Promise<void> {
  await rescheduleEvent(ctx.api, eventId, minutesFromNow);
  await awaitProcessing(ctx.api);
  await ctx.api.post(`/scheduling-polls/${matchId}/complete`, { eventId });
  await awaitProcessing(ctx.api);
  await flushEmbedQueue(ctx.api);
}

/** Assert the channel embed shows the RESCHEDULING card for this event. */
function waitForReschedulingEmbed(
  channelId: string,
  title: string,
  timeoutMs: number,
) {
  return waitForEmbedUpdate(
    channelId,
    (m) =>
      m.embeds.some(
        (e) => e.title?.includes(title) && e.title.includes('RESCHEDULING'),
      ),
    timeoutMs,
  );
}

/** Assert the channel embed is back to the live (non-RESCHEDULING) card. */
function waitForLiveEmbed(
  channelId: string,
  title: string,
  timeoutMs: number,
) {
  return waitForEmbedUpdate(
    channelId,
    (m) =>
      m.embeds.some(
        (e) =>
          e.title?.includes(title) &&
          !e.title.includes('RESCHEDULING') &&
          !!e.description?.includes('<t:'),
      ),
    timeoutMs,
  );
}

const pollStartSuppressesEvent: SmokeTest = {
  name: 'ROK-1370: poll start flips embed to RESCHEDULING and tears down the Scheduled Event',
  category: 'flow',
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ch = channelForTest(ctx, 0);
    const gameId = ch.gameId ?? (await resolveGameId(ctx));
    const ev = await createEvent(ctx.api, 'resched-start', { gameId });
    try {
      await pollForEmbed(
        ch.channelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await awaitProcessing(ctx.api);
      await pollForCondition(
        () => findScheduledEventByTitle(ev.title),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );

      await openReschedulePoll(ctx.api, gameId, ev.id);
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      // Embed shows RESCHEDULING and the Scheduled Event is gone.
      await waitForReschedulingEmbed(ch.channelId, ev.title, ctx.config.timeoutMs);
      await pollForCondition(
        async () => ((await findScheduledEventByTitle(ev.title)) ? null : true),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const lockInRestoresEventRepeatably: SmokeTest = {
  name: 'ROK-1370: lock-in restores the live embed + Scheduled Event, repeatably',
  category: 'flow',
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ch = channelForTest(ctx, 1);
    const gameId = ch.gameId ?? (await resolveGameId(ctx));
    const ev = await createEvent(ctx.api, 'resched-cycle', { gameId });
    try {
      await pollForEmbed(
        ch.channelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );

      // Two full reschedule cycles prove repeatability (ROK-1370 Part 3).
      for (const minutes of [240, 360]) {
        const poll = await openReschedulePoll(ctx.api, gameId, ev.id);
        await awaitProcessing(ctx.api);
        await flushEmbedQueue(ctx.api);
        await waitForReschedulingEmbed(
          ch.channelId,
          ev.title,
          ctx.config.timeoutMs,
        );

        await lockIn(ctx, ev.id, poll.id, minutes);

        // Embed back to the live card and the Scheduled Event recreated.
        await waitForLiveEmbed(ch.channelId, ev.title, ctx.config.timeoutMs);
        await pollForCondition(
          () => findScheduledEventByTitle(ev.title),
          ctx.config.timeoutMs,
          { intervalMs: 2000 },
        );
      }
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const reschedulePollLockInTests: SmokeTest[] = [
  pollStartSuppressesEvent,
  lockInRestoresEventRepeatably,
];
