/**
 * ROK-2272 S4 review MAJOR-2 — a non-hub event's Discord-only registry post
 * that a moderator deleted on Discord. The signup flush that finds the
 * thread gone marks the registry row deleted and returns `'offline'` (a
 * retried outcome, review round 2 MINOR-R2-1); the retry creates a fresh
 * post, exactly like the first signup creates it. Harness copied from
 * `event-planning-posts.signup-pings.integration.spec.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { DiscordAPIError } from 'discord.js';
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
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import {
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
let createPost: jest.SpyInstance;
let channelId: string;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;
const flush = (eventId: number) =>
  app().get(HubForumDiscordSignupPings).flush(eventId);

/** Discord's Unknown Channel (10003, 404): the post was deleted. */
const unknownChannel = () =>
  new DiscordAPIError(
    { code: 10003, message: 'Unknown Channel' },
    10003,
    404,
    'POST',
    '/channels/x/messages',
    {},
  );

/** Spy the bot's registry-post writes; each create returns a fresh id. */
function stubPlanning(): void {
  const gw = app().get(EventPlanningPostsGateway);
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
  createPost = jest
    .spyOn(gw, 'createPost')
    .mockImplementation(() => Promise.resolve(snowflake()));
  jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
  jest.spyOn(gw, 'deleteThread').mockResolvedValue('ok');
}

/** Pin the event-planning forum resolver to `forumId`. */
function resolveTo(forumId: number): void {
  const forum = { forumId, channelId, managed: true, webhookId: null };
  jest
    .spyOn(app().get(EventPlanningForumResolver), 'resolve')
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

/** A non-hub, non-ad-hoc event ending in 2 h, with no signups. */
async function nonHubEvent(): Promise<number> {
  const end = new Date(Date.now() + 2 * HOUR);
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title: 'Onyxia',
        creatorId: ctx.ids.creator,
        gameId: ctx.posts.testApp.seed.game.id,
        guildId: null,
        isAdHoc: false,
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
    .where(and(eq(p.subjectKind, 'event'), eq(p.subjectId, eventId)))
    .orderBy(p.id);
}

beforeAll(async () => {
  ctx = await bootDiscussion('evplgn');
  // Only members with a Discord id get a line; without these every flush
  // is 'unchanged' (same setup as the signup-pings spec).
  did = await giveDiscordIds(ctx);
});

beforeEach(async () => {
  resetThrottles(ctx);
  const fake = stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
  stubPlanning();
  channelId = fake.put({ tags: [] }).id;
  resolveTo(await newForumRow(channelId));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S4 review MAJOR-2: a registry post deleted on Discord', () => {
  it('the flush that finds it gone marks it deleted; the next flush makes a new post', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    expect(await flush(eventId)).toBe('pinged');
    const [first] = nonEmpty(await registryRows(eventId), 'first post');

    await signUp(ctx, eventId, 'tentative', 'tentative');
    out.spies.mention.mockRejectedValueOnce(unknownChannel());
    // MINOR-R2-1: a retried outcome, so the queue re-runs the flush.
    expect(await flush(eventId)).toBe('offline');
    const [gone] = nonEmpty(await registryRows(eventId), 'gone post');
    expect(gone.id).toBe(first.id);
    expect(gone.discordDeletedAt).not.toBeNull();
    expect(createPost).toHaveBeenCalledTimes(1);

    // What the retry does: a NEW post, both members mentioned into it.
    expect(await flush(eventId)).toBe('pinged');
    expect(createPost).toHaveBeenCalledTimes(2);
    const rows = await registryRows(eventId);
    expect(rows).toHaveLength(2);
    const fresh = nonEmpty(rows.slice(1), 'fresh post')[0];
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.discordDeletedAt).toBeNull();
    expect(fresh.discordThreadId).not.toBe(first.discordThreadId);
    const intoFresh = out.spies.mention.mock.calls
      .filter((c) => c[0] === fresh.discordThreadId)
      .flatMap((c) => [...c[2]])
      .sort();
    expect(intoFresh).toEqual([did.signed, did.tentative].sort());
  });

  it('any other Discord error still throws and leaves the post live', async () => {
    const eventId = await nonHubEvent();
    await signUp(ctx, eventId, 'signed', 'signed_up');
    await flush(eventId);
    await signUp(ctx, eventId, 'tentative', 'tentative');
    out.spies.mention.mockRejectedValueOnce(new Error('discord 500'));
    await expect(flush(eventId)).rejects.toThrow('discord 500');
    const [row] = nonEmpty(await registryRows(eventId), 'post');
    expect(row.discordDeletedAt).toBeNull();
  });
});
