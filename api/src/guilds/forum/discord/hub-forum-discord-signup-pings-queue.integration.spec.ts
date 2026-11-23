/**
 * ROK-2260 — the debounce and the deploy catch-up against a real database
 * and a real BullMQ queue. Repeated signup changes on one event leave ONE
 * delayed flush job (the timer resets, ruling 2); a real `signup.created`
 * emit arms it through the listener; the one-time catch-up (ruling 5) arms
 * upcoming bound events only and never runs twice.
 * Jobs are delayed 2 min, so none fires during the spec; each test drains.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { SIGNUP_EVENTS } from '../../../discord-bot/discord-bot.constants';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  endEvent,
  resetThrottles,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { stubOutbound } from './hub-forum-discord-outbound.test-fixtures';
import {
  SIGNUP_PING_DEBOUNCE_MS,
  signupPingJobId,
} from './hub-forum-discord-signup-pings';
import {
  HubForumDiscordSignupPingCatchUp,
  SIGNUP_PING_CATCH_UP_KEY,
} from './hub-forum-discord-signup-pings.catch-up';
import {
  HubForumDiscordSignupPingQueue,
  SIGNUP_PING_QUEUE,
  type SignupPingJobData,
} from './hub-forum-discord-signup-pings.queue';
import {
  bareScene,
  bindHub,
} from './hub-forum-discord-signup-pings.test-fixtures';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

let ctx: DiscussionCtx;
let raw: Queue<SignupPingJobData>;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdspq');
  raw = ctx.posts.testApp.app.get<Queue<SignupPingJobData>>(
    getQueueToken(SIGNUP_PING_QUEUE),
  );
});

beforeEach(async () => {
  resetThrottles(ctx);
  stubForumGateway(ctx.posts.testApp);
  stubOutbound(ctx.posts.testApp);
  await raw.drain(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await raw.drain(true);
});

const app = () => ctx.posts.testApp.app;

/** Ids of the queued (not yet run) flush jobs for `eventId`. */
async function queuedFor(eventId: number): Promise<string[]> {
  const jobs = await raw.getJobs(['delayed', 'waiting', 'active']);
  return jobs
    .filter((j) => j.data.eventId === eventId)
    .map((j) => j.id ?? '(no id)');
}

/** A bound scene's event id. */
async function boundEvent(): Promise<number> {
  const s = await bareScene(ctx);
  await bindHub(ctx, s.guildId);
  return s.eventId;
}

/**
 * When the job is due, in epoch ms: BullMQ scores a delayed job
 * `dueAt * 0x1000 + n` in the delayed ZSET, and `changeDelay` re-scores it
 * from "now" while `job.delay` keeps its value — so the score is the only
 * place a timer reset shows. Null when the job is not in the delayed set.
 */
async function dueAt(jobId: string): Promise<number | null> {
  const client = await raw.getBackend().client;
  const score = await client.zscore(raw.toKey('delayed'), jobId);
  return score === null ? null : Math.floor(Number(score) / 0x1000);
}

describe('ROK-2260 signup pings — debounce (ruling 2)', () => {
  it('a second change before the delay elapses pushes the ONE delayed job back (review m7)', async () => {
    const eventId = await boundEvent();
    const id = signupPingJobId(eventId);
    const queue = app().get(HubForumDiscordSignupPingQueue);
    await queue.schedule(eventId);
    const first = await dueAt(id);
    if (first === null) throw new Error('first schedule left no delayed job');
    // The clock must move before the reset, or "pushed back" is unprovable.
    await waitFor(() => {
      expect(Date.now()).toBeGreaterThan(first - SIGNUP_PING_DEBOUNCE_MS);
      return Promise.resolve();
    });
    await queue.schedule(eventId);
    expect(await queuedFor(eventId)).toEqual([id]);
    expect(await raw.getJob(id).then((j) => j?.getState())).toBe('delayed');
    const second = await dueAt(id);
    expect({
      pushedBack: second !== null && second > first,
      first,
      second,
    }).toEqual({ pushedBack: true, first, second });
  });

  it('a signup.created emit arms the flush through the listener', async () => {
    const eventId = await boundEvent();
    app()
      .get(EventEmitter2)
      .emit(SIGNUP_EVENTS.CREATED, { eventId, action: 'signed_up' });
    await waitFor(async () => {
      expect(await queuedFor(eventId)).toEqual([signupPingJobId(eventId)]);
    });
  });
});

describe('ROK-2260 signup pings — deploy catch-up (ruling 5)', () => {
  it('arms upcoming bound events only, and never runs twice', async () => {
    const upcomingA = await boundEvent();
    const upcomingB = await boundEvent();
    const ended = await boundEvent();
    const cancelled = await boundEvent();
    await endEvent(ctx, ended);
    await ctx.posts.testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, cancelled));
    await ctx.posts.testApp.redisMock.client.del(SIGNUP_PING_CATCH_UP_KEY);

    const catchUp = app().get(HubForumDiscordSignupPingCatchUp);
    expect(await catchUp.run(new Date())).toBeGreaterThanOrEqual(2);
    const armed = await Promise.all(
      [upcomingA, upcomingB, ended, cancelled].map(
        async (id) => (await queuedFor(id)).length,
      ),
    );
    expect(armed).toEqual([1, 1, 0, 0]);
    expect(await catchUp.run(new Date())).toBe(0);
  });
});
