/**
 * ROK-2260 — signup pings against a real database. One flush of an event in
 * a bound hub: the first signup creates the event's Discord post (ruling 1)
 * and ONE roll-up @mention names the new players (ruling 2); tentative and
 * bench are pinged, declined is not (ruling 4); an anonymous Discord signup
 * is pinged; a cancel leaves the post silently and a re-signup pings again
 * (ruling 3); an unbound hub, a detached thread or a closed one does nothing.
 * Discord is the in-memory outbound gateway (spies on the app's singleton).
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  as,
  bootDiscussion,
  endEvent,
  resetThrottles,
  setSignupStatus,
  signUp,
  untagEvent,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { pingedSetKey } from './hub-forum-discord-signup-pings';
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
async function pinged(eventId: number): Promise<string[]> {
  const key = pingedSetKey(eventId);
  return (await ctx.posts.testApp.redisMock.client.smembers(key)).sort();
}

async function threadLinks(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  return ctx.posts.testApp.db.select().from(l).where(eq(l.threadId, threadId));
}

const sorted = (...ids: string[]): string[] => [...ids].sort();

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
    expect(await pinged(s.eventId)).toEqual([did.signed]);
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
    expect(out.spies.mention).toHaveBeenCalledTimes(1);
    expect(await pinged(s.eventId)).toEqual([did.tentative]);

    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(mentioned()).toEqual([
      sorted(did.signed, did.tentative),
      [did.signed],
    ]);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
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
    expect(await pinged(s.eventId)).toEqual([]);
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
