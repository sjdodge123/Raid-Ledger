/**
 * ROK-2272 S4 review MAJOR-2 — a non-hub event's Discord-only registry post
 * that a moderator deleted on Discord. The signup flush that finds the
 * thread gone marks the registry row deleted and stops (`'closed'`); the
 * next flush creates a fresh post (decision: re-created by the next signup
 * change, exactly like the first signup creates it). Harness copied from
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
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;

let ctx: DiscussionCtx;
let out: FakeOutbound;
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
    expect(await flush(eventId)).toBe('closed');
    const [gone] = nonEmpty(await registryRows(eventId), 'gone post');
    expect(gone.id).toBe(first.id);
    expect(gone.discordDeletedAt).not.toBeNull();
    expect(createPost).toHaveBeenCalledTimes(1);

    expect(await flush(eventId)).toBe('pinged');
    expect(createPost).toHaveBeenCalledTimes(2);
    const rows = await registryRows(eventId);
    expect(rows).toHaveLength(2);
    const fresh = nonEmpty(rows.slice(1), 'fresh post')[0];
    expect(fresh.discordDeletedAt).toBeNull();
    expect(fresh.discordThreadId).not.toBe(first.discordThreadId);
    expect(out.spies.mention).toHaveBeenLastCalledWith(
      fresh.discordThreadId,
      expect.any(String),
      expect.any(Array),
    );
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
