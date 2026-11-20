/**
 * ROK-2272 S4b — signup pings for NON-HUB events against a real database.
 * A non-hub, non-ad-hoc event gets the same Discord behaviour as a bound
 * hub event (lines, pings, removals), written into its Discord-only
 * registry post in the event-planning forum; the first line creates that
 * post through `EventPlanningPostsService.ensureEventPost`. A hub event
 * with a bound hub still uses the hub post and never touches the registry.
 */
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  resetThrottles,
  signUp,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { pingedSetKey } from './hub-forum-discord-signup-pings';
import { listUpcomingBoundEventIds } from './hub-forum-discord-signup-pings.queries';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import {
  bareScene,
  bindHub,
  cancelSignup,
  giveDiscordIds,
  type Pingable,
} from './hub-forum-discord-signup-pings.test-fixtures';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;

let ctx: DiscussionCtx;
let out: FakeOutbound;
let did: Record<Pingable, string>;
let planning: ReturnType<typeof stubPlanning>;
let forumId: number;
let channelId: string;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;
const flush = (eventId: number) =>
  app().get(HubForumDiscordSignupPings).flush(eventId);

/** Spy the bot's registry-post writes; each create returns a fresh id. */
function stubPlanning() {
  const gw = app().get(EventPlanningPostsGateway);
  return {
    isOnline: jest.spyOn(gw, 'isOnline').mockReturnValue(true),
    createPost: jest
      .spyOn(gw, 'createPost')
      .mockImplementation(() => Promise.resolve(snowflake())),
    renameThread: jest.spyOn(gw, 'renameThread').mockResolvedValue('ok'),
    deleteThread: jest.spyOn(gw, 'deleteThread').mockResolvedValue('ok'),
  };
}

/** Pin the event-planning forum resolver to `id` (null = none resolves). */
function resolveTo(id: number | null): void {
  const resolver = app().get(EventPlanningForumResolver);
  const forum =
    id === null
      ? null
      : { forumId: id, channelId, managed: true, webhookId: null };
  jest
    .spyOn(resolver, 'resolve')
    .mockResolvedValue({ forum, candidates: [], warning: null });
}

async function newForumRow(channel: string): Promise<number> {
  const [f] = nonEmpty(
    await db()
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId: channel })
      .returning(),
    'forum',
  );
  return f.id;
}

interface EventOver {
  isAdHoc?: boolean;
  cancelledAt?: Date;
}

/** A non-hub event ending in 2 h, with no signups. */
async function nonHubEvent(over: EventOver = {}): Promise<number> {
  const end = new Date(Date.now() + 2 * HOUR);
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title: 'Onyxia',
        creatorId: ctx.ids.creator,
        gameId: ctx.posts.testApp.seed.game.id,
        guildId: null,
        isAdHoc: over.isAdHoc ?? false,
        cancelledAt: over.cancelledAt ?? null,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function registryRows(eventId: number) {
  const p = schema.eventPlanningPosts;
  return db()
    .select()
    .from(p)
    .where(and(eq(p.subjectKind, 'event'), eq(p.subjectId, eventId)));
}

/** The registry post's pinged set, sorted. */
async function pinged(eventId: number, postId: number): Promise<string[]> {
  const key = pingedSetKey(eventId, { planningPostId: postId });
  return (await ctx.posts.testApp.redisMock.client.smembers(key)).sort();
}

const mentioned = (): string[][] =>
  out.spies.mention.mock.calls.map((c) => [...c[2]].sort());

beforeAll(async () => {
  ctx = await bootDiscussion('evplsp');
  did = await giveDiscordIds(ctx);
});

beforeEach(async () => {
  resetThrottles(ctx);
  const fake = stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
  planning = stubPlanning();
  channelId = fake.put({ tags: [] }).id;
  forumId = await newForumRow(channelId);
  resolveTo(forumId);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S4b non-hub signup pings — the registry post', () => {
  it('the first signup creates the registry post and mentions the player in it', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    expect(await flush(eventId)).toBe('pinged');
    expect(planning.createPost).toHaveBeenCalledTimes(1);
    expect(out.spies.createPost).not.toHaveBeenCalled();
    const [row] = nonEmpty(await registryRows(eventId), 'registry row');
    expect(row.forumId).toBe(forumId);
    expect(out.spies.mention.mock.calls).toEqual([
      [
        row.discordThreadId,
        expect.stringContaining(`<@${did.signed}>`),
        [did.signed],
      ],
    ]);
    expect(await pinged(eventId, row.id)).toEqual([did.signed]);
  });

  it('a second flush with no change posts nothing and creates nothing', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    await flush(eventId);
    expect(await flush(eventId)).toBe('unchanged');
    expect(planning.createPost).toHaveBeenCalledTimes(1);
    expect(out.spies.mention).toHaveBeenCalledTimes(1);
    expect(await registryRows(eventId)).toHaveLength(1);
  });

  it('a second member is pinged into the SAME post', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    await flush(eventId);
    await signUp(ctx, eventId, 'tentative', 'tentative');
    expect(await flush(eventId)).toBe('pinged');
    const [row] = nonEmpty(await registryRows(eventId), 'registry row');
    expect(planning.createPost).toHaveBeenCalledTimes(1);
    expect(out.spies.mention.mock.calls.map((c) => c[0])).toEqual([
      row.discordThreadId,
      row.discordThreadId,
    ]);
    expect(mentioned()).toEqual([[did.signed], [did.tentative]]);
    expect(await pinged(eventId, row.id)).toEqual(
      [did.signed, did.tentative].sort(),
    );
  });

  it('a leaver is named without a ping and removed from the post', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    await signUp(ctx, eventId, 'tentative', 'tentative');
    await flush(eventId);
    const [row] = nonEmpty(await registryRows(eventId), 'registry row');
    await cancelSignup(ctx, eventId, 'signed');
    expect(await flush(eventId)).toBe('pinged');
    expect(out.spies.removeThreadMembers.mock.calls).toEqual([
      [row.discordThreadId, [did.signed], expect.any(Function)],
    ]);
    expect(out.spies.mention).toHaveBeenCalledTimes(2);
    expect(mentioned()[1]).toEqual([]);
    expect(await pinged(eventId, row.id)).toEqual([did.tentative]);
  });
});

describe('ROK-2272 S4b non-hub signup pings — no post', () => {
  it('a cancelled non-hub event with no post creates nothing', async () => {
    const eventId = await nonHubEvent({ cancelledAt: new Date() });
    await signUp(ctx, eventId, 'signed', 'signed_up');
    expect(await flush(eventId)).toBe('unchanged');
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(await registryRows(eventId)).toEqual([]);
  });

  it('no event-planning forum resolves: closed, and no Discord call', async () => {
    resolveTo(null);
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    expect(await flush(eventId)).toBe('closed');
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(await registryRows(eventId)).toEqual([]);
  });

  it('an ad-hoc event stays unbound', async () => {
    const eventId = await nonHubEvent({ isAdHoc: true });
    await signUp(ctx, eventId, 'signed', 'signed_up');
    expect(await flush(eventId)).toBe('unbound');
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(out.spies.mention).not.toHaveBeenCalled();
  });

  it('a hub event with a bound hub still uses the hub post (registry untouched)', async () => {
    const s = await bareScene(ctx);
    await bindHub(ctx, s.guildId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect(await flush(s.eventId)).toBe('pinged');
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(await registryRows(s.eventId)).toEqual([]);
  });
});

describe('ROK-2272 S4b deploy catch-up', () => {
  it('includes a non-hub event with a live registry post, not one without', async () => {
    const withPost = await nonHubEvent();
    await signUp(ctx, withPost, 'signed', 'signed_up');
    await flush(withPost);
    const without = await nonHubEvent();
    const ids = await listUpcomingBoundEventIds(db(), new Date());
    expect(ids).toContain(withPost);
    expect(ids).not.toContain(without);
    expect(planning.createPost).toHaveBeenCalledTimes(1);
  });
});
