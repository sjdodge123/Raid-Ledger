/**
 * ROK-2208 OQ-4 (review B1 item 4) against a real database: an untagged or
 * multi-hub-tag post in a SHARED forum is not synced and gets ONE bot reply
 * ("Add one hub tag…"); `hub_forum_discord_notices` makes it once per post
 * across repeat messages, races and restarts. Never for echoes, never in a
 * single-binding forum. Discord is the spied `postNotice` on
 * `HubForumDiscordOutboundGateway`.
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  resetThrottler,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { TAG_NOTICE } from './hub-forum-discord-notice';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import {
  HubForumDiscordRouteResolver,
  type InboundMessage,
  type InboundThread,
} from './hub-forum-discord-route';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const EPOCH = 1420070400000n;
let seq = 0;
const freshId = (): string =>
  (
    ((BigInt(Date.now() + 60_000) - EPOCH) << 22n) |
    BigInt((seq += 1))
  ).toString();

let ctx: PostsCtx;
let adminToken: string;
let ingest: HubForumDiscordInboundIngest;
let out: FakeOutbound;
const noBot = { botUserId: null };

beforeAll(async () => {
  ctx = await bootPostsApp('hfdnt');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfdnt-admin@forum.test',
        username: 'hfdnt-admin',
        role: 'admin',
      })
      .returning(),
    'admin',
  );
  adminToken = await signTestAccessToken(ctx.testApp, {
    sub: u.id,
    username: u.username,
    role: 'admin',
  });
  ingest = ctx.testApp.app.get(HubForumDiscordInboundIngest);
});

beforeEach(() => {
  resetThrottler(ctx);
  stubForumGateway(ctx.testApp);
  out = stubOutbound(ctx.testApp);
  ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
});

afterEach(() => jest.restoreAllMocks());

interface Forum {
  forumId: number;
  channelId: string;
  webhookId: string | null;
}

/** Hub A binds its own forum; `shared` adds hub B with tags tA/tB. */
async function forum(shared: boolean): Promise<Forum> {
  const g = await newHub(ctx);
  const res = await ctx.testApp.request
    .put(`/guilds/${g}/forum-discord`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ forumId: f.id, channelId: f.channelId, webhookId: f.webhookId })
      .from(b)
      .innerJoin(f, eq(f.id, b.forumId))
      .where(eq(b.guildId, g)),
    'binding',
  );
  if (shared) {
    await ctx.testApp.db.update(b).set({ tagId: 'tA' }).where(eq(b.guildId, g));
    const now = new Date();
    const other = await newHub(ctx);
    await ctx.testApp.db
      .insert(b)
      .values({
        guildId: other,
        forumId: row.forumId,
        tagId: 'tB',
        ackAt: now,
        boundAt: now,
      });
  }
  ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
  return row;
}

function post(parentId: string, appliedTags: string[] = []): InboundThread {
  const id = freshId();
  return {
    id,
    parentId,
    name: 'Untagged',
    appliedTags,
    pinned: false,
    archived: false,
  };
}

function msg(
  t: InboundThread,
  over: Partial<InboundMessage> = {},
): InboundMessage {
  return {
    id: freshId(),
    threadId: t.id,
    authorId: `d${freshId()}`,
    authorName: 'Wanderer',
    authorAvatar: null,
    webhookId: null,
    content: 'Hello',
    mentions: new Map(),
    attachments: [],
    ...over,
  };
}

async function noticeRows(discordThreadId: string) {
  const n = schema.hubForumDiscordNotices;
  return ctx.testApp.db
    .select()
    .from(n)
    .where(eq(n.discordThreadId, discordThreadId));
}

describe('ROK-2208 OQ-4: shared-forum tag notice', () => {
  it('an untagged post gets one notice, not again on later or racing messages', async () => {
    const { forumId, channelId } = await forum(true);
    const t = post(channelId);
    expect(await ingest.onCreate(msg(t, { id: t.id }), t, noBot)).toBe(
      'skipped',
    );
    await Promise.all([
      ingest.onCreate(msg(t), t, noBot),
      ingest.onCreate(msg(t), t, noBot),
    ]);
    expect(out.spies.postNotice).toHaveBeenCalledTimes(1);
    expect(out.spies.postNotice).toHaveBeenCalledWith(t.id, TAG_NOTICE);
    const rows = await noticeRows(t.id);
    expect(rows.map((r) => r.forumId)).toEqual([forumId]);
  });

  it('a post carrying both hub tags gets one notice', async () => {
    const { channelId } = await forum(true);
    const t = post(channelId, ['tA', 'tB']);
    expect(await ingest.onCreate(msg(t, { id: t.id }), t, noBot)).toBe(
      'skipped',
    );
    expect(out.spies.postNotice).toHaveBeenCalledTimes(1);
    expect(out.spies.postNotice).toHaveBeenCalledWith(t.id, TAG_NOTICE);
  });

  it('a single-binding forum imports the untagged post and never notices', async () => {
    const { channelId } = await forum(false);
    const t = post(channelId);
    expect(await ingest.onCreate(msg(t, { id: t.id }), t, noBot)).toBe(
      'imported',
    );
    expect(out.spies.postNotice).not.toHaveBeenCalled();
    expect(await noticeRows(t.id)).toEqual([]);
  });

  it('our bot and our webhook never trigger a notice (echoes)', async () => {
    const { channelId, webhookId } = await forum(true);
    expect(webhookId).not.toBeNull();
    const t = post(channelId);
    const ours = msg(t, { id: t.id, authorId: 'our-bot' });
    expect(await ingest.onCreate(ours, t, { botUserId: 'our-bot' })).toBe(
      'skipped',
    );
    expect(await ingest.onCreate(msg(t, { webhookId }), t, noBot)).toBe(
      'skipped',
    );
    expect(out.spies.postNotice).not.toHaveBeenCalled();
    expect(await noticeRows(t.id)).toEqual([]);
  });

  it('a failed send forgets the notice so the next message retries', async () => {
    const { channelId } = await forum(true);
    const t = post(channelId);
    out.spies.postNotice.mockRejectedValueOnce(new Error('Discord 500'));
    expect(await ingest.onCreate(msg(t, { id: t.id }), t, noBot)).toBe(
      'skipped',
    );
    expect(await noticeRows(t.id)).toEqual([]);
    await ingest.onCreate(msg(t), t, noBot);
    expect(out.spies.postNotice).toHaveBeenCalledTimes(2);
    expect(await noticeRows(t.id)).toHaveLength(1);
  });
});
