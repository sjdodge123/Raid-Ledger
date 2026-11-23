/**
 * ROK-2292 — a hub event's forum post opens with the signup card and tracks
 * its starter, against a real database (Discord = the in-memory outbound
 * gateway). D8: the announcement creates the post; the lazy first-reply
 * creator racing it (either order) never makes a second post or a second
 * starter row, and the row is `channel_id = message_id = thread id`. D6: a
 * retitle of a carded post renames only. D7 + reopen: the lock sweep drops
 * the row and a reschedule restores it and queues a re-sync. R4: our own
 * starter's edit (empty content) is never ingested as an RL body edit.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { APP_EVENT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import * as schema from '../../../drizzle/schema';
import { settle } from '../../posts/hub-posts.test-fixtures';
import { syncEventDiscussion } from '../event-discussion/event-discussion.sync';
import {
  as,
  bootDiscussion,
  endEvent,
  newScene,
  resetThrottles,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import {
  starterRows,
  stubStarterSync,
} from './forum-starter-card.test-fixtures';
import { HubForumDiscordAnnounceListener } from './hub-forum-discord-announce.listener';
import { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { snowflake, stubForumGateway } from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let ctx: DiscussionCtx;
let out: FakeOutbound;
let enqueue: jest.SpyInstance;

const testApp = () => ctx.posts.testApp;
const db = () => testApp().db;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdcard');
});

beforeEach(() => {
  resetThrottles(ctx);
  stubForumGateway(testApp());
  out = stubOutbound(testApp());
  ({ enqueue } = stubStarterSync(testApp()));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function bind(guildId: number): Promise<void> {
  const res = await testApp()
    .request.put(`/guilds/${guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
}

async function boundScene(): Promise<Scene> {
  const s = await newScene(ctx);
  await bind(s.guildId);
  return s;
}

/** D8 — what `EVENT_ANNOUNCEMENT_POSTED` runs, awaited. */
function announce(eventId: number): Promise<void> {
  return testApp()
    .app.get(HubForumDiscordAnnounceListener)
    .onAnnounced({ eventId });
}

/** A live RL reply (the lazy creator); waits until it reached Discord. */
async function reply(s: Scene, body: string, replies: number): Promise<void> {
  const path = `/events/${s.eventId}/discussion/replies`;
  const res = await as(ctx, 'signed', 'post', path, { body });
  expect(res.status).toBe(201);
  await waitFor(async () => {
    expect(out.spies.createReply).toHaveBeenCalledTimes(replies);
    return Promise.resolve();
  });
  await settle(out.apply);
}

async function postLink(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  const rows = await db().select().from(l).where(eq(l.threadId, threadId));
  return nonEmpty(
    rows.filter((r) => r.kind === 'thread'),
    'post link',
  )[0];
}

/** One post, created with the card, whose starter is the one tracked row. */
async function expectOneCardedPost(s: Scene): Promise<string> {
  expect(out.spies.createPost).toHaveBeenCalledTimes(1);
  const [[, post]] = nonEmpty(out.spies.createPost.mock.calls, 'createPost');
  expect(post.card?.embeds).toHaveLength(1);
  const link = await postLink(s.threadId);
  expect(link.discordMessageId).toBe(link.discordThreadId);
  expect(await starterRows(testApp(), s.eventId)).toEqual([
    { channelId: link.discordThreadId, messageId: link.discordThreadId },
  ]);
  return link.discordThreadId;
}

describe('ROK-2292 D8 hub event post on announce', () => {
  it('announce creates the carded post + starter row; the first reply reuses it', async () => {
    const s = await boundScene();
    await announce(s.eventId);
    const threadId = await expectOneCardedPost(s);
    await reply(s, 'First!', 1);
    expect(out.spies.createReply.mock.calls[0]?.[1]).toBe(threadId);
    await announce(s.eventId);
    expect(await expectOneCardedPost(s)).toBe(threadId);
  });

  it('reverse order: the first reply creates it, a later announce adds nothing', async () => {
    const s = await boundScene();
    await reply(s, 'Early bird', 1);
    const threadId = await expectOneCardedPost(s);
    await announce(s.eventId);
    expect(await expectOneCardedPost(s)).toBe(threadId);
  });

  it('a concurrent announce and first reply make exactly one post', async () => {
    const s = await boundScene();
    await Promise.all([announce(s.eventId), reply(s, 'Racing', 1)]);
    await expectOneCardedPost(s);
  });
});

describe('ROK-2292 D6 retitle of a carded post', () => {
  it('renames the post and never sends the text body onto the card', async () => {
    const s = await boundScene();
    await announce(s.eventId);
    const threadId = await expectOneCardedPost(s);
    const retitle = jest.spyOn(out.service, 'retitleEvent');
    const start = new Date(Date.now() + 3 * DAY);
    await db()
      .update(schema.events)
      .set({
        title: 'Onyxia',
        duration: [start, new Date(start.getTime() + HOUR)],
      })
      .where(eq(schema.events.id, s.eventId));
    testApp()
      .app.get(EventEmitter2)
      .emit(APP_EVENT_EVENTS.UPDATED, { eventId: s.eventId });
    await waitFor(async () => {
      expect(retitle).toHaveBeenCalledTimes(1);
      return Promise.resolve();
    });
    await settle(retitle);
    await settle(out.apply);
    expect(out.spies.renameThread.mock.calls.map((c) => c[0])).toEqual([
      threadId,
    ]);
    expect(out.spies.editMessage).not.toHaveBeenCalled();
  });
});

describe('ROK-2292 D7 lock drops the starter row; reopen restores it', () => {
  it('a reschedule after the lock re-tracks the starter and queues a re-sync', async () => {
    const s = await boundScene();
    await announce(s.eventId);
    const threadId = await expectOneCardedPost(s);
    jest
      .spyOn(testApp().app.get(HubForumDiscordEventLockGateway), 'setReadOnly')
      .mockResolvedValue('ok');
    const sweep = testApp().app.get(HubForumDiscordEventLockSweep);

    await endEvent(ctx, s.eventId);
    await sweep.sweep(new Date());
    expect((await postLink(s.threadId)).discordLockedAt).not.toBeNull();
    expect(await starterRows(testApp(), s.eventId)).toEqual([]);

    const start = new Date(Date.now() + 2 * HOUR);
    await db()
      .update(schema.events)
      .set({ duration: [start, new Date(start.getTime() + HOUR)] })
      .where(eq(schema.events.id, s.eventId));
    await syncEventDiscussion(db(), s.eventId, new Date());
    await sweep.sweep(new Date());
    expect((await postLink(s.threadId)).discordLockedAt).toBeNull();
    expect(await starterRows(testApp(), s.eventId)).toEqual([
      { channelId: threadId, messageId: threadId },
    ]);
    expect(enqueue).toHaveBeenCalledWith(s.eventId, 'forum-starter-reopened');
  });
});

describe('ROK-2292 R4 our own starter edit is not ingested', () => {
  it('an empty-content edit of the webhook starter is skipped; the RL body stays', async () => {
    const s = await boundScene();
    await announce(s.eventId);
    const threadId = await expectOneCardedPost(s);
    const t = schema.hubForumThreads;
    const read = async () =>
      nonEmpty(
        await db().select().from(t).where(eq(t.id, s.threadId)),
        'thread',
      )[0];
    const before = await read();
    const f = schema.hubForumDiscordForums;
    const b = schema.hubForumDiscordBindings;
    const [forum] = nonEmpty(
      await db()
        .select({ channelId: f.channelId })
        .from(b)
        .innerJoin(f, eq(f.id, b.forumId))
        .where(eq(b.guildId, s.guildId)),
      'binding',
    );
    const result = await testApp()
      .app.get(HubForumDiscordInboundIngest)
      .onUpdate(
        {
          id: threadId,
          threadId,
          authorId: snowflake(),
          authorName: 'Raid Ledger',
          authorAvatar: null,
          webhookId: snowflake(),
          content: '',
          mentions: new Map(),
          attachments: [],
        },
        forum.channelId,
        new Date(Date.now() + DAY),
      );
    expect(result).toBe('skipped');
    const after = await read();
    expect(after.body).toBe(before.body);
    expect(after.editedAt).toEqual(before.editedAt);
  });
});
