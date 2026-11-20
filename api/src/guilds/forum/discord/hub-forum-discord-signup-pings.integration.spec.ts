/**
 * ROK-2260 — signup pings against a real database. One flush of an event in
 * a bound hub: the first signup creates the event's Discord post (ruling 1)
 * and ONE roll-up @mention names the new players (ruling 2); tentative and
 * bench are pinged, declined is not (ruling 4); an anonymous Discord signup
 * is pinged; a cancel leaves the post silently and a re-signup pings again
 * (ruling 3); an unbound hub, a detached thread or a closed one does nothing.
 * Discord is the in-memory outbound gateway (spies on the app's singleton).
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { waitFor } from '../../../common/testing/integration-helpers';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import * as schema from '../../../drizzle/schema';
import { EventsService } from '../../../events/events.service';
import { RunningLateService } from '../../../events/running-late.service';
import { SignupsService } from '../../../events/signups.service';
import { SettingsService } from '../../../settings/settings.service';
import {
  as,
  bootDiscussion,
  endEvent,
  outcome,
  resetThrottles,
  setSignupStatus,
  signUp,
  untagEvent,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import {
  lineResyncKey,
  postedLinesKey,
} from './hub-forum-discord-signup-lines.flush';
import {
  pingedSetKey,
  signupPingJobId,
} from './hub-forum-discord-signup-pings';
import { SIGNUP_PING_QUEUE } from './hub-forum-discord-signup-pings.queue';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import {
  bareScene,
  bindHub,
  cancelSignup,
  giveDiscordIds,
  signUpBench,
  type Pingable,
} from './hub-forum-discord-signup-pings.test-fixtures';
import { snowflake, stubForumGateway } from './hub-forum-discord.test-fixtures';

let ctx: DiscussionCtx;
let out: FakeOutbound;
let did: Record<Pingable, string>;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdsp');
  did = await giveDiscordIds(ctx);
});

beforeEach(() => {
  resetThrottles(ctx);
  stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const flush = (eventId: number) =>
  ctx.posts.testApp.app.get(HubForumDiscordSignupPings).flush(eventId);

/** Each mention's pinged user ids, sorted — one entry per bot message. */
const mentioned = (): string[][] =>
  out.spies.mention.mock.calls.map((c) => [...c[2]].sort());

/** The event's "already pinged" set, sorted. */
async function pinged(s: Scene): Promise<string[]> {
  const key = pingedSetKey(s.eventId, s);
  return (await ctx.posts.testApp.redisMock.client.smembers(key)).sort();
}

async function threadLinks(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  return ctx.posts.testApp.db.select().from(l).where(eq(l.threadId, threadId));
}

const sorted = (...ids: string[]): string[] => [...ids].sort();

const HOUR = 60 * 60 * 1000;

/** Move the event to start `ms` from now (2 h long). */
async function startsIn(eventId: number, ms: number): Promise<void> {
  const start = new Date(Date.now() + ms);
  await ctx.posts.testApp.db
    .update(schema.events)
    .set({ duration: [start, new Date(start.getTime() + 2 * HOUR)] })
    .where(eq(schema.events.id, eventId));
}

describe('ROK-2260 signup pings — first signup and roll-ups', () => {
  it('the first signup creates the post and one mention names that player', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');
    expect(link).toMatchObject({ kind: 'thread', syncState: 'synced' });
    expect(out.spies.mention.mock.calls).toEqual([
      [
        link.discordThreadId,
        expect.stringContaining(`<@${did.signed}>`),
        [did.signed],
      ],
    ]);
    expect(await pinged(s)).toEqual([did.signed]);
  });

  it('later signups get ONE roll-up naming only the new players; nothing new sends nothing', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await flush(s.eventId);
    await signUp(ctx, s.eventId, 'pug', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(mentioned()).toEqual([[did.signed], sorted(did.pug, did.tentative)]);
    expect(await flush(s.eventId)).toBe('unchanged');
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
  });

  it('tentative and bench are pinged; a declined signup is not (ruling 4)', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUpBench(ctx, s.eventId);
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await signUp(ctx, s.eventId, 'declined', 'signed_up');
    await setSignupStatus(ctx, s.eventId, 'declined', 'declined');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([sorted(did.bench, did.tentative)]);
  });

  it('an anonymous Discord signup (no RL account) is pinged', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    const anon = snowflake();
    await ctx.posts.testApp.db.insert(schema.eventSignups).values({
      eventId: s.eventId,
      discordUserId: anon,
      discordUsername: 'anon-pug',
      status: 'signed_up',
    });
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([[anon]]);
  });
});

describe('ROK-2260 signup pings — cancel and re-signup (ruling 3)', () => {
  it('a cancel removes the player silently; a re-signup pings them again', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await flush(s.eventId);
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');

    await cancelSignup(ctx, s.eventId, 'signed');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(out.spies.removeThreadMembers.mock.calls).toEqual([
      [link.discordThreadId, [did.signed], expect.any(Function)],
    ]);
    // ROK-2271: the leaver gets a line naming them, never a ping.
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
    expect(mentioned()[1]).toEqual([]);
    expect(await pinged(s)).toEqual([did.tentative]);

    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([
      sorted(did.signed, did.tentative),
      [],
      [did.signed],
    ]);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
  });
});

/** One step the fake Discord post saw, in order. */
type PostStep = ['setArchived', boolean] | ['remove', string];

/**
 * An auto-archived, unlocked Discord forum post — the discord.js slice the
 * real `removeThreadMembers` touches — recording each call in order.
 */
function archivedPost(id: string): { post: { id: string }; steps: PostStep[] } {
  const steps: PostStep[] = [];
  const post = {
    id,
    archived: true,
    locked: false,
    isThread: () => true,
    setArchived(archived: boolean): Promise<void> {
      steps.push(['setArchived', archived]);
      post.archived = archived;
      return Promise.resolve();
    },
    members: {
      remove(userId: string): Promise<void> {
        // Discord refuses Remove Thread Member on an archived post.
        if (post.archived) return Promise.reject(new Error('archived'));
        steps.push(['remove', userId]);
        return Promise.resolve();
      },
    },
  };
  return { post, steps };
}

/** Let the REAL gateway removal run against `post` on a fake bot guild. */
function realRemovalAgainst(post: { id: string }): void {
  out.spies.removeThreadMembers.mockRestore();
  const client = ctx.posts.testApp.app.get(DiscordBotClientService);
  const fetch = (id: string) => Promise.resolve(id === post.id ? post : null);
  const guild = { channels: { fetch } } as unknown as Guild;
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockReturnValue(guild);
}

describe('ROK-2260 signup pings — the real cancel path (review m8)', () => {
  afterEach(async () => {
    // The cancel's signup.deleted arms a 2-min flush job; never let it fire.
    await ctx.posts.testApp.app
      .get<Queue>(getQueueToken(SIGNUP_PING_QUEUE))
      .drain(true);
  });

  it('DELETE /events/:id/signup, then a flush reopens the archived post, removes the player and re-archives', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    // A graceful decline (> 23 h out): it stays on the debounce, so the flush
    // below is the one that removes. A late cancel (roach-out) flushes at
    // once instead — ROK-2271 C4, covered at the bottom of this file.
    await startsIn(s.eventId, 48 * HOUR);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await flush(s.eventId);
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');

    const res = await as(
      ctx,
      'signed',
      'delete',
      `/events/${s.eventId}/signup`,
    );
    expect(outcome(res)).toEqual({
      status: 200,
      message: 'Signup canceled successfully',
    });

    const { post, steps } = archivedPost(link.discordThreadId);
    realRemovalAgainst(post);
    expect(await flush(s.eventId)).toBe('pinged');
    expect(steps).toEqual([
      ['setArchived', false],
      ['remove', did.signed],
      ['setArchived', true],
    ]);
    // ROK-2271: one leave line (no ping) on top of the first signup lines.
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
    expect(await pinged(s)).toEqual([did.tentative]);
  });
});

describe('ROK-2260 signup pings — no-ops', () => {
  it('an unbound hub posts and pings nothing', async () => {
    const s = await bareScene(ctx);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('unbound');
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(await threadLinks(s.threadId)).toEqual([]);
  });

  it('a detached event thread posts and pings nothing', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await untagEvent(ctx, s.eventId);
    expect(await flush(s.eventId)).toBe('unbound');
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
  });

  it('a closed thread (write_closes_at passed) creates no post and pings nobody', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await endEvent(ctx, s.eventId);
    expect(await flush(s.eventId)).toBe('closed');
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(await pinged(s)).toEqual([]);
  });
});

describe('ROK-2260 DEMO_MODE flush endpoint (companion smoke)', () => {
  const ORIGINAL = process.env.DEMO_MODE;
  const path = (id: number) =>
    `/admin/test/hub-forum-discord/events/${id}/flush-signup-pings`;

  // DemoModeGuard needs BOTH the env flag and the DB setting.
  const settings = () => ctx.posts.testApp.app.get(SettingsService);

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    await settings().setDemoMode(true);
  });

  afterEach(async () => {
    if (ORIGINAL === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL;
    await settings().setDemoMode(false);
  });

  it('flushes now and names the post; refuses a non-admin and DEMO_MODE off', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect((await as(ctx, 'plain', 'post', path(s.eventId))).status).toBe(403);
    process.env.DEMO_MODE = 'false';
    expect((await as(ctx, 'admin', 'post', path(s.eventId))).status).toBe(403);
    expect(out.spies.mention).not.toHaveBeenCalled();
    process.env.DEMO_MODE = 'true';

    const res = await as(ctx, 'admin', 'post', path(s.eventId));
    expect(res.status).toBe(201);
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');
    expect({ status: res.status, body: res.body as unknown }).toEqual({
      status: 201,
      body: { outcome: 'pinged', discordThreadId: link.discordThreadId },
    });
    expect(mentioned()).toEqual([[did.signed]]);
  });
});

/** Put `signupId` on a fresh character (Warrior) in roster slot `role`. */
async function onCharacter(s: Scene, signupId: number, role: string) {
  const db = ctx.posts.testApp.db;
  const [c] = nonEmpty(
    await db
      .insert(schema.characters)
      .values({
        userId: ctx.ids.signed,
        gameId: ctx.posts.testApp.seed.game.id,
        name: `Thrall${s.eventId}`,
        class: 'Warrior',
        spec: 'Protection',
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  await db
    .update(schema.eventSignups)
    .set({ characterId: c.id })
    .where(eq(schema.eventSignups.id, signupId));
  await db
    .insert(schema.rosterAssignments)
    .values({ eventId: s.eventId, signupId, role, position: 1 });
}

/** The text of the n-th bot message (0-based). */
const message = (n: number): string =>
  String(out.spies.mention.mock.calls[n]?.[1]);

describe('ROK-2271 signup lines — role, character and status', () => {
  it('a first signup with role + character posts one line that pings them', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    const id = await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await onCharacter(s, id, 'tank');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([[did.signed]]);
    expect(message(0)).toBe(
      `✅ <@${did.signed}> signed up — Tank · Thrall${s.eventId} (Protection Warrior)`,
    );
  });

  it('tentative → confirmed posts a line WITHOUT a ping; no change posts nothing', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'tentative');
    await flush(s.eventId);
    await setSignupStatus(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([[did.signed], []]);
    expect(message(1)).toContain('is confirmed (was tentative)');
    expect(message(1)).not.toContain('<@');
    expect(await flush(s.eventId)).toBe('unchanged');
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
  });

  it('two changes in one window post ONE combined line', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    const id = await signUp(ctx, s.eventId, 'signed', 'tentative');
    await onCharacter(s, id, 'tank');
    await flush(s.eventId);
    await setSignupStatus(ctx, s.eventId, 'signed', 'signed_up');
    const r = schema.rosterAssignments;
    await ctx.posts.testApp.db
      .update(r)
      .set({ role: 'healer' })
      .where(eq(r.signupId, id));
    expect(await flush(s.eventId)).toBe('pinged');
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
    expect(message(1).split('\n')).toHaveLength(1);
    expect(message(1)).toContain('is confirmed (was tentative)');
    expect(message(1)).toContain('Tank → Healer');
  });

  it('deploy-time seeding: a thread pinged before ROK-2271 posts nothing on its first flush', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    const redis = ctx.posts.testApp.redisMock.client;
    await redis.sadd(pingedSetKey(s.eventId, s), did.signed, did.tentative);
    expect(await flush(s.eventId)).toBe('unchanged');
    expect(out.spies.mention).not.toHaveBeenCalled();
    const seeded = await redis.hgetall(postedLinesKey(s.eventId, s));
    expect(Object.keys(seeded).sort()).toEqual(
      sorted('_seeded', did.signed, did.tentative),
    );
    // A real change after the seed is posted, without a ping.
    await setSignupStatus(ctx, s.eventId, 'tentative', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([[]]);
    expect(message(0)).toContain('is confirmed (was tentative)');
  });
});

/** Bot messages so far, once the urgent flush has posted the n-th one. */
async function awaitMessages(n: number): Promise<void> {
  await waitFor(async () => {
    expect(out.spies.mention).toHaveBeenCalledTimes(n);
    return Promise.resolve();
  }, 10_000);
}

/** No debounced flush left that could post the same line again later. */
async function debouncedJobs(eventId: number): Promise<string[]> {
  const q = ctx.posts.testApp.app.get<Queue>(getQueueToken(SIGNUP_PING_QUEUE));
  const ids = [signupPingJobId(eventId), signupPingJobId(eventId, true)];
  const delayed = await q.getJobs(['delayed']);
  return delayed.map((j) => j.id ?? '').filter((id) => ids.includes(id));
}

describe('ROK-2271 C4 — running late and roach-out post at once', () => {
  it('running late via the service posts ONE late line at once, no ping', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await flush(s.eventId);
    const late = ctx.posts.testApp.app.get(RunningLateService);
    expect(await late.setRunningLate(s.eventId, ctx.ids.signed, 15)).toBe(true);
    await awaitMessages(2);
    expect(message(1)).toMatch(/^⏰ .+ is running late \(~15 min\)$/);
    expect(mentioned()).toEqual([[did.signed], []]);
    expect(await debouncedJobs(s.eventId)).toEqual([]);
    expect(await flush(s.eventId)).toBe('unchanged');
    // Clearing it posts "on time again", also at once.
    expect(await late.clearRunningLate(s.eventId, ctx.ids.signed)).toBe(true);
    await awaitMessages(3);
    expect(message(2)).toMatch(/^👍 .+ is on time again$/);
  });

  it('a roach-out (cancel < 23 h before start) posts ONE line at once and leaves the post', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await startsIn(s.eventId, 3 * HOUR + 10 * 60_000);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await flush(s.eventId);
    await ctx.posts.testApp.app
      .get(SignupsService)
      .cancel(s.eventId, ctx.ids.signed);
    await awaitMessages(2);
    expect(message(1)).toMatch(/^🪳 .+ roached out \(3 h before start\)$/);
    expect(mentioned()).toEqual([[did.signed], []]);
    await waitFor(async () => {
      expect(await pinged(s)).toEqual([]);
    }, 10_000);
    expect(await debouncedJobs(s.eventId)).toEqual([]);
    expect(await flush(s.eventId)).toBe('unchanged');
  });
});

/** Each actor's signup status on the event, by actor. */
async function statusOf(eventId: number, who: Pingable): Promise<string> {
  const t = schema.eventSignups;
  const rows = await ctx.posts.testApp.db
    .select({ userId: t.userId, status: t.status })
    .from(t)
    .where(eq(t.eventId, eventId));
  const row = rows.find((r) => r.userId === ctx.ids[who]);
  return row?.status ?? 'none';
}

describe('review MAJOR-1 — a reschedule reset posts nothing misleading', () => {
  it('tentative + roached-out members: reschedule ⇒ no message, no mention; a real change still posts', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await startsIn(s.eventId, 3 * HOUR + 10 * 60_000);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await flush(s.eventId);
    await ctx.posts.testApp.app
      .get(SignupsService)
      .cancel(s.eventId, ctx.ids.signed);
    await awaitMessages(2); // the roach-out line
    const start = Date.now() + 48 * HOUR;
    await ctx.posts.testApp.app
      .get(EventsService)
      .reschedule(s.eventId, ctx.ids.bench, true, {
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + 2 * HOUR).toISOString(),
      });
    const redis = ctx.posts.testApp.redisMock.client;
    await waitFor(async () => {
      expect(await redis.get(lineResyncKey(s.eventId))).toBe('1');
    }, 10_000);
    // The reset really flipped both (the false-line precondition).
    expect(await statusOf(s.eventId, 'signed')).toBe('signed_up');
    expect(await statusOf(s.eventId, 'tentative')).toBe('signed_up');
    expect(await flush(s.eventId)).toBe('unchanged');
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
    // A real change after the reschedule still posts, unpinged.
    await setSignupStatus(ctx, s.eventId, 'tentative', 'tentative');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([[did.signed, did.tentative].sort(), [], []]);
    expect(message(2)).toMatch(/tentative/);
  });
});
