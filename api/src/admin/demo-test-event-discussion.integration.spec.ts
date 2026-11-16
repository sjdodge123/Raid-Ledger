/**
 * ROK-2226 L5 — POST /admin/test/hubs/:id/event-discussion/seed (integration,
 * real DB): the jwt + admin + DEMO_MODE guard trio, 404/400, what each seeded
 * viewer sees on `GET events/:id/discussion` (the smoke spec pins these), the
 * locked thread, and a re-seed replacing the hub's fixture events.
 */
import type {
  EventDiscussionReady,
  HubForumThreadList,
} from '@raid-ledger/contract';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import {
  bootPostsApp,
  call,
  newHub,
  type PostsCtx,
  type Who,
} from '../guilds/posts/hub-posts.test-fixtures';
import { SettingsService } from '../settings/settings.service';
import {
  OPEN_REPLY_BODIES,
  type EventDiscussionSeedResult,
} from './demo-test-event-discussion.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const TAG = 'evdisc-it';
let ctx: PostsCtx;
let adminToken: string;

const route = (g: number) => `/admin/test/hubs/${g}/event-discussion/seed`;

beforeAll(async () => {
  ctx = await bootPostsApp('evdiscseed');
  adminToken = await loginAsAdmin(ctx.testApp.request, ctx.testApp.seed);
  process.env.DEMO_MODE = 'true';
  await ctx.testApp.app.get(SettingsService).setDemoMode(true);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

function post(g: number, token: string, body: object) {
  return ctx.testApp.request
    .post(route(g))
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** `plain` signs up and replies; `officerB` (a member) only reads. */
function seedBody(): object {
  return {
    memberUserId: ctx.userIds.plain,
    readerUserId: ctx.userIds.officerB,
    tag: TAG,
  };
}

async function seed(g: number): Promise<EventDiscussionSeedResult> {
  const res = await post(g, adminToken, seedBody());
  expect(res.status).toBe(200);
  return res.body as EventDiscussionSeedResult;
}

async function discussionAs(
  who: Who,
  eventId: number,
): Promise<{ status: number; body: EventDiscussionReady }> {
  const res = await call(ctx, 'get', `/events/${eventId}/discussion`, who);
  return { status: res.status, body: res.body as EventDiscussionReady };
}

async function discussionAsPug(
  s: EventDiscussionSeedResult,
): Promise<EventDiscussionReady> {
  const token = await signTestAccessToken(ctx.testApp, {
    sub: s.pugUserId,
    username: `evdisc-pug-${TAG}`,
    role: 'member',
  });
  const res = await ctx.testApp.request
    .get(`/events/${s.eventId}/discussion`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as EventDiscussionReady;
}

describe('ROK-2226 event-discussion seed — guards', () => {
  it('refuses a non-admin, an unknown hub, a bad body and DEMO_MODE off', async () => {
    const g = await newHub(ctx);
    expect((await post(g, ctx.tokens.plain, seedBody())).status).toBe(403);
    expect((await post(2_000_000_000, adminToken, seedBody())).status).toBe(
      404,
    );
    const noReader = { memberUserId: ctx.userIds.plain };
    expect((await post(g, adminToken, noReader)).status).toBe(400);
    process.env.DEMO_MODE = 'false';
    try {
      expect((await post(g, adminToken, seedBody())).status).toBe(403);
    } finally {
      process.env.DEMO_MODE = 'true';
    }
  });
});

describe('ROK-2226 event-discussion seed — viewers', () => {
  it('the signed-up member can reply and is told they are a member', async () => {
    const s = await seed(await newHub(ctx));
    const { status, body } = await discussionAs('plain', s.eventId);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      state: 'ready',
      threadId: s.threadId,
      replyCount: OPEN_REPLY_BODIES.length,
      lock: null,
      can: { read: true, reply: true },
      member: true,
    });
    expect(body.latestReplies.map((r) => r.body).sort()).toEqual(
      [...OPEN_REPLY_BODIES].sort(),
    );
  });

  it('the reader (member, not signed up) reads but cannot reply', async () => {
    const s = await seed(await newHub(ctx));
    const { body } = await discussionAs('officerB', s.eventId);
    expect(body).toMatchObject({
      can: { read: true, reply: false },
      member: true,
    });
  });

  it('the PUG (signed up, not a member) replies through the event panel', async () => {
    const s = await seed(await newHub(ctx));
    const body = await discussionAsPug(s);
    expect(body).toMatchObject({
      can: { read: true, reply: true },
      member: false,
    });
  });

  it('the ended event (+27 h) is locked: read-only for the signed-up member', async () => {
    const s = await seed(await newHub(ctx));
    const { body } = await discussionAs('plain', s.lockedEventId);
    expect(body).toMatchObject({
      threadId: s.lockedThreadId,
      lock: { reason: 'event-ended' },
      can: { read: true, reply: false },
    });
  });
});

describe('ROK-2226 event-discussion seed — idempotent', () => {
  it('a re-seed replaces the fixture events and threads and keeps one PUG', async () => {
    const g = await newHub(ctx);
    const first = await seed(g);
    const second = await seed(g);
    expect(second.pugUserId).toBe(first.pugUserId);
    expect(second.eventId).not.toBe(first.eventId);
    expect((await discussionAs('plain', first.eventId)).status).toBe(404);
    const res = await call(ctx, 'get', `/guilds/${g}/forum`, 'plain');
    const list = res.body as HubForumThreadList;
    const ids = [...list.pinned, ...list.threads]
      .map((t) => t.id)
      .sort((x, y) => x - y);
    expect(ids).toEqual(
      [second.threadId, second.lockedThreadId].sort((x, y) => x - y),
    );
  });
});
