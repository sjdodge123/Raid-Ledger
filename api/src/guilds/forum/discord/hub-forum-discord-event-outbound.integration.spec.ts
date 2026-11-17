/**
 * ROK-2208 §5.7 items 1, 2 — event threads outbound against a real database.
 * An event thread gets NO Discord post when it is created (schedule time);
 * its first live RL reply creates the post (dated title, 2226 root text) and
 * then sends the reply; the next reply reuses the post; an event update
 * renames the post once — but never after an unbind or a re-bind (D9, review
 * MAJOR-1), nor while the post is locked. Discord is the in-memory gateway.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { APP_EVENT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { settle } from '../../posts/hub-posts.test-fixtures';
import {
  addEventThread,
  as,
  bootDiscussion,
  newScene,
  resetThrottles,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import { eventPostTitle } from './hub-forum-discord-event-outbound';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let ctx: DiscussionCtx;
let out: FakeOutbound;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdevt');
});

beforeEach(() => {
  resetThrottles(ctx);
  stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const db = () => ctx.posts.testApp.db;

async function bind(guildId: number): Promise<void> {
  const res = await ctx.posts.testApp.request
    .put(`/guilds/${guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
}

/** Post a live reply as a signed-up player and wait for the sync. */
async function reply(s: Scene, body: string, calls: number): Promise<void> {
  const path = `/events/${s.eventId}/discussion/replies`;
  const res = await as(ctx, 'signed', 'post', path, { body });
  expect(res.status).toBe(201);
  await waitFor(async () => {
    expect(out.apply).toHaveBeenCalledTimes(calls);
    return Promise.resolve();
  });
  await settle(out.apply);
}

async function threadLinks(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  return db().select().from(l).where(eq(l.threadId, threadId));
}

/** The title the post should carry for the event as it is now. */
async function expectedTitle(eventId: number): Promise<string> {
  const [e] = nonEmpty(
    await db()
      .select({ title: schema.events.title, duration: schema.events.duration })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event',
  );
  const zone = await ctx.posts.testApp.app
    .get(SettingsService)
    .getDefaultTimezone();
  return eventPostTitle(e.title, e.duration[0], zone);
}

/** Edit + reschedule the event, emit UPDATED and wait for the retitle. */
async function reschedule(s: Scene, title: string): Promise<void> {
  const retitle = jest.spyOn(out.service, 'retitleEvent');
  const start = new Date(Date.now() + 3 * DAY);
  await db()
    .update(schema.events)
    .set({ title, duration: [start, new Date(start.getTime() + 2 * HOUR)] })
    .where(eq(schema.events.id, s.eventId));
  const emitter = ctx.posts.testApp.app.get(EventEmitter2);
  emitter.emit(APP_EVENT_EVENTS.UPDATED, { eventId: s.eventId });
  await waitFor(async () => {
    expect(retitle).toHaveBeenCalledTimes(1);
    return Promise.resolve();
  });
  await settle(retitle);
  retitle.mockRestore();
}

/** Move the binding's bound_at past the post (what a re-bind stamps). */
async function rebind(guildId: number): Promise<void> {
  const b = schema.hubForumDiscordBindings;
  await db()
    .update(b)
    .set({ boundAt: new Date(Date.now() + HOUR) })
    .where(eq(b.guildId, guildId));
}

describe('ROK-2208 §5.7 event threads → Discord', () => {
  it('posts nothing when an event thread is created in a bound hub', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    const later = await addEventThread(ctx, s.guildId);
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(await threadLinks(s.threadId)).toEqual([]);
    expect(await threadLinks(later)).toEqual([]);
  });

  it('the first live reply creates the dated post, then sends the reply; the second reuses it', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    await reply(s, 'First!', 1);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    const [[, post, author]] = nonEmpty(
      out.spies.createPost.mock.calls,
      'createPost',
    );
    expect(post.title).toBe(await expectedTitle(s.eventId));
    expect(post.content).toContain(`/events/${s.eventId})`);
    expect(author.username).toBe('Raid Ledger');
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');
    expect(link).toMatchObject({ kind: 'thread', syncState: 'synced' });
    const [first] = nonEmpty(out.spies.createReply.mock.calls, 'createReply');
    expect(first[1]).toBe(link.discordThreadId);
    expect(first[2]).toBe('First!');
    expect(
      nonEmpty(out.spies.createPost.mock.invocationCallOrder, 'post order')[0],
    ).toBeLessThan(
      nonEmpty(out.spies.createReply.mock.invocationCallOrder, 'reply')[0],
    );

    await reply(s, 'Second', 2);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(out.spies.createReply).toHaveBeenCalledTimes(2);
    expect(out.spies.createReply.mock.calls[1]?.[1]).toBe(link.discordThreadId);
  });

  it('an event retitle/reschedule renames the linked post once', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    await reply(s, 'Ready', 1);
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');
    await reschedule(s, 'Onyxia');
    const name = await expectedTitle(s.eventId);
    expect(out.spies.renameThread).toHaveBeenCalledTimes(1);
    const [[threadId, renamed]] = nonEmpty(
      out.spies.renameThread.mock.calls,
      'renameThread',
    );
    expect([threadId, renamed]).toEqual([link.discordThreadId, name]);
    expect(name.startsWith('Onyxia — ')).toBe(true);
  });

  it('review MAJOR-1: after an unbind an event edit renames nothing (D9)', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    await reply(s, 'Ready', 1);
    const res = await ctx.posts.testApp.request
      .delete(`/guilds/${s.guildId}/forum-discord`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(204);
    await reschedule(s, 'Unbound raid');
    expect(out.spies.renameThread).not.toHaveBeenCalled();
    expect(out.spies.editMessage).not.toHaveBeenCalled();
  });

  it('review MAJOR-1: after a re-bind the old forum post is not renamed', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    await reply(s, 'Ready', 1);
    await rebind(s.guildId);
    await reschedule(s, 'Rebound raid');
    expect(out.spies.renameThread).not.toHaveBeenCalled();
    expect(out.spies.editMessage).not.toHaveBeenCalled();
  });

  it('review MINOR-1: a locked (archived) post is not edited until reopened', async () => {
    const s = await newScene(ctx);
    await bind(s.guildId);
    await reply(s, 'Ready', 1);
    const l = schema.hubForumDiscordLinks;
    await db()
      .update(l)
      .set({ discordLockedAt: new Date() })
      .where(eq(l.threadId, s.threadId));
    await reschedule(s, 'Locked raid');
    expect(out.spies.renameThread).not.toHaveBeenCalled();
    const [link] = nonEmpty(await threadLinks(s.threadId), 'post link');
    expect(link.syncState).toBe('synced');
  });
});
