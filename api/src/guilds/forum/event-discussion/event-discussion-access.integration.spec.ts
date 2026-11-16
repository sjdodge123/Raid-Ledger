/**
 * ROK-2226 L3c — the §6 permission matrix against a real database, one test
 * per row (read / reply / edit-own / delete-own / moderate), the §5.4
 * read-only lock (ended + detached), §5.5 (thread root is lifecycle-owned),
 * §13 AC12 (D7: empty event threads stay out of the forum list) and the §6.1
 * reply throttle. Each test builds its own hub + event + thread (`newScene`).
 * Non-event threads are covered by `hub-forum-access.integration.spec.ts`.
 */
import type {
  EventDiscussion,
  HubForumLatest,
  HubForumReply,
  HubForumThread,
  HubForumThreadList,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND, setHubHidden } from '../../hub-hidden.helpers';
import { HUB_POST_CREATE_LIMIT } from '../../posts/hub-post-throttle.guard';
import { FORUM_NOT_MEMBER } from '../hub-forum.access';
import {
  FORUM_EVENT_THREAD_MANAGED,
  FORUM_NOT_SIGNED_UP,
  FORUM_THREAD_READ_ONLY,
} from './event-discussion.access';
import { DISCUSSION_NOT_FOUND } from './event-discussion.service';
import {
  addEventThread,
  as,
  bootDiscussion,
  endEvent,
  newScene,
  outcome,
  resetThrottles,
  setSignupStatus,
  signUp,
  untagEvent,
  type Actor,
  type DiscussionCtx,
  type Scene,
} from './event-discussion.test-fixtures';

let ctx: DiscussionCtx;

beforeAll(async () => {
  ctx = await bootDiscussion('evdisc');
});

beforeEach(() => {
  resetThrottles(ctx);
});

const ev = (s: Scene) => `/events/${s.eventId}/discussion`;
const hubThread = (s: Scene) => `/guilds/${s.guildId}/forum/${s.threadId}`;
const deny = (status: number, message: string) => ({ status, message });

/** POST a reply through the event route; must be 201. */
async function reply(s: Scene, who: Actor, body = 'r'): Promise<HubForumReply> {
  const res = await as(ctx, who, 'post', `${ev(s)}/replies`, { body });
  expect(outcome(res)).toEqual({ status: 201, message: undefined });
  return res.body as HubForumReply;
}

const replyAs = (s: Scene, who: Actor) =>
  as(ctx, who, 'post', `${ev(s)}/replies`, { body: 'x' });
const editAs = (s: Scene, who: Actor, id: number) =>
  as(ctx, who, 'patch', `${ev(s)}/replies/${id}`, { body: 'edited' });
const deleteAs = (s: Scene, who: Actor, id: number) =>
  as(ctx, who, 'delete', `${ev(s)}/replies/${id}`);

/** The live reply bodies of the thread, as a member sees them. */
async function liveBodies(s: Scene): Promise<string[]> {
  const res = await as(ctx, 'plain', 'get', hubThread(s));
  expect(res.status).toBe(200);
  const t = res.body as HubForumThread;
  return t.replies.filter((r) => r.deleted === null).map((r) => r.body);
}

describe('ROK-2226 §6 — member, not signed up', () => {
  it('reads both routes but cannot reply (403 FORUM_NOT_SIGNED_UP)', async () => {
    const s = await newScene(ctx);
    expect((await as(ctx, 'plain', 'get', `${ev(s)}/thread`)).status).toBe(200);
    expect((await as(ctx, 'plain', 'get', hubThread(s))).status).toBe(200);
    expect(outcome(await replyAs(s, 'plain'))).toEqual(
      deny(403, FORUM_NOT_SIGNED_UP),
    );
    const viaHub = await as(ctx, 'plain', 'post', `${hubThread(s)}/replies`, {
      body: 'x',
    });
    expect(outcome(viaHub)).toEqual(deny(403, FORUM_NOT_SIGNED_UP));
    expect(await liveBodies(s)).toEqual([]);
  });
});

describe('ROK-2226 §6 — signed-up, benched and tentative members', () => {
  it.each<Actor>(['signed', 'bench', 'tentative'])(
    '%s replies (201), edits own (200) and deletes own (204)',
    async (who) => {
      const s = await newScene(ctx);
      const r = await reply(s, who, `from ${who}`);
      expect(r.can).toMatchObject({ edit: true, delete: true });
      const edit = await editAs(s, who, r.id);
      expect(outcome(edit)).toEqual({ status: 200, message: undefined });
      expect((edit.body as HubForumReply).body).toBe('edited');
      expect((await deleteAs(s, who, r.id)).status).toBe(204);
      expect(await liveBodies(s)).toEqual([]);
    },
  );
});

describe('ROK-2226 §6 — signed-up non-member (PUG, ruling 11)', () => {
  it('reads and writes THIS thread via the event routes, never the hub forum', async () => {
    const s = await newScene(ctx);
    const read = await as(ctx, 'pug', 'get', `${ev(s)}/thread`);
    expect(read.status).toBe(200);
    expect((read.body as HubForumThread).id).toBe(s.threadId);
    const r = await reply(s, 'pug', 'pug here');
    expect(outcome(await editAs(s, 'pug', r.id)).status).toBe(200);
    const list = await as(ctx, 'pug', 'get', `/guilds/${s.guildId}/forum`);
    expect(list.status).toBe(403);
    expect((await as(ctx, 'pug', 'get', hubThread(s))).status).toBe(403);
    expect(await liveBodies(s)).toEqual(['edited']);
  });
});

describe('ROK-2226 §7 / AC13 — the card summary reports hub membership', () => {
  it('a signed-up member gets member: true, a signed-up non-member member: false', async () => {
    const s = await newScene(ctx);
    const mine = await as(ctx, 'signed', 'get', ev(s));
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ state: 'ready', member: true });
    const pug = await as(ctx, 'pug', 'get', ev(s));
    expect(pug.status).toBe(200);
    expect(pug.body).toMatchObject({
      state: 'ready',
      can: { read: true, reply: true },
      member: false,
    });
  });
});

describe('ROK-2226 §6 — was signed up, now declined', () => {
  it('a member keeps reading and deleting own, but cannot reply or edit', async () => {
    const s = await newScene(ctx);
    const r = await reply(s, 'declined', 'before');
    await setSignupStatus(ctx, s.eventId, 'declined', 'declined');
    expect((await as(ctx, 'declined', 'get', `${ev(s)}/thread`)).status).toBe(
      200,
    );
    expect(outcome(await replyAs(s, 'declined'))).toEqual(
      deny(403, FORUM_NOT_SIGNED_UP),
    );
    expect(outcome(await editAs(s, 'declined', r.id))).toEqual(
      deny(403, FORUM_NOT_SIGNED_UP),
    );
    expect(await liveBodies(s)).toEqual(['before']);
    expect((await deleteAs(s, 'declined', r.id)).status).toBe(204);
    expect(await liveBodies(s)).toEqual([]);
  });

  it('a non-member loses the thread (403 FORUM_NOT_MEMBER)', async () => {
    const s = await newScene(ctx);
    await reply(s, 'pug', 'before');
    await setSignupStatus(ctx, s.eventId, 'pug', 'declined');
    const read = await as(ctx, 'pug', 'get', `${ev(s)}/thread`);
    expect(outcome(read)).toEqual(deny(403, FORUM_NOT_MEMBER));
    expect(outcome(await replyAs(s, 'pug'))).toEqual(
      deny(403, FORUM_NOT_MEMBER),
    );
  });
});

describe('ROK-2226 §6 — delete own, for everyone (review MINOR-2)', () => {
  it("a withdrawn non-member deletes their own reply (204) but nobody else's (403)", async () => {
    const s = await newScene(ctx);
    const own = await reply(s, 'pug', 'mine');
    const theirs = await reply(s, 'signed', 'member text');
    await setSignupStatus(ctx, s.eventId, 'pug', 'declined');
    expect(outcome(await deleteAs(s, 'pug', theirs.id))).toEqual(
      deny(403, FORUM_NOT_MEMBER),
    );
    expect(outcome(await editAs(s, 'pug', own.id))).toEqual(
      deny(403, FORUM_NOT_MEMBER),
    );
    expect((await deleteAs(s, 'pug', own.id)).status).toBe(204);
    expect(await liveBodies(s)).toEqual(['member text']);
  });
});

describe('ROK-2226 §6 — hub Leader (canEdit) and staff (ruling 12)', () => {
  it.each<Actor>(['officerA', 'admin'])(
    '%s, not signed up: reads, cannot reply or edit others, removes others (204)',
    async (who) => {
      const s = await newScene(ctx);
      const theirs = await reply(s, 'signed', 'member text');
      expect((await as(ctx, who, 'get', `${ev(s)}/thread`)).status).toBe(200);
      expect(outcome(await replyAs(s, who))).toEqual(
        deny(403, FORUM_NOT_SIGNED_UP),
      );
      expect((await editAs(s, who, theirs.id)).status).toBe(403);
      expect(await liveBodies(s)).toEqual(['member text']);
      expect((await deleteAs(s, who, theirs.id)).status).toBe(204);
      expect(await liveBodies(s)).toEqual([]);
    },
  );

  it('a Leader who signs up may reply', async () => {
    const s = await newScene(ctx);
    expect(outcome(await replyAs(s, 'officerB')).status).toBe(403);
    await signUp(ctx, s.eventId, 'officerB', 'signed_up');
    expect(outcome(await replyAs(s, 'officerB')).status).toBe(201);
  });

  it('a plain member cannot remove another member reply', async () => {
    const s = await newScene(ctx);
    const theirs = await reply(s, 'signed', 'keep me');
    expect((await deleteAs(s, 'bench', theirs.id)).status).toBe(403);
    expect(await liveBodies(s)).toEqual(['keep me']);
  });
});

describe('ROK-2226 §6 — event creator, not a member, not signed up (ruling 13)', () => {
  it('reads via the event route, cannot reply, and the hub routes stay closed', async () => {
    const s = await newScene(ctx);
    await reply(s, 'signed', 'hello');
    const read = await as(ctx, 'creator', 'get', `${ev(s)}/thread`);
    expect(read.status).toBe(200);
    expect((read.body as HubForumThread).replies.map((r) => r.body)).toEqual([
      'hello',
    ]);
    expect(outcome(await replyAs(s, 'creator'))).toEqual(
      deny(403, FORUM_NOT_SIGNED_UP),
    );
    expect((await as(ctx, 'creator', 'get', hubThread(s))).status).toBe(403);
  });
});

describe('ROK-2226 §6 — hub visitor, not signed up', () => {
  it('gets the card header only and 403 FORUM_NOT_MEMBER on the thread', async () => {
    const s = await newScene(ctx);
    await reply(s, 'signed', 'hidden from visitors');
    const card = await as(ctx, 'outsider', 'get', ev(s));
    expect(card.status).toBe(200);
    expect(card.body as EventDiscussion).toMatchObject({
      state: 'ready',
      replyCount: 1,
      latestReplies: [],
      can: { read: false, reply: false },
    });
    const read = await as(ctx, 'outsider', 'get', `${ev(s)}/thread`);
    expect(outcome(read)).toEqual(deny(403, FORUM_NOT_MEMBER));
    expect(outcome(await replyAs(s, 'outsider'))).toEqual(
      deny(403, FORUM_NOT_MEMBER),
    );
  });
});

describe('ROK-2226 §6.1 — hidden or archived hub (Codex P1)', () => {
  /** A signed-up non-member is refused like HubVisibleGuard; staff still read. */
  async function expectClosed(s: Scene): Promise<void> {
    const read = await as(ctx, 'pug', 'get', `${ev(s)}/thread`);
    expect(outcome(read)).toEqual(deny(404, HUB_NOT_FOUND));
    expect(outcome(await replyAs(s, 'pug'))).toEqual(deny(404, HUB_NOT_FOUND));
    const card = await as(ctx, 'pug', 'get', ev(s));
    expect(card.status).toBe(200);
    expect(card.body as EventDiscussion).toEqual({ state: 'none' });
    expect((await as(ctx, 'admin', 'get', `${ev(s)}/thread`)).status).toBe(200);
  }

  it('a hidden hub: read 404, post 404, card none (staff still read)', async () => {
    const s = await newScene(ctx);
    await reply(s, 'pug', 'before hide');
    await setHubHidden(ctx.posts.testApp.db, s.guildId, true);
    await expectClosed(s);
  });

  it('an archived hub: read 404, post 404, card none (staff still read)', async () => {
    const s = await newScene(ctx);
    await reply(s, 'pug', 'before archive');
    await ctx.posts.testApp.db
      .update(schema.guilds)
      .set({ status: 'archived' })
      .where(eq(schema.guilds.id, s.guildId));
    await expectClosed(s);
  });
});

describe('ROK-2226 §5.4 — read-only 24 h after the event ends', () => {
  it('reply 409, edit-own 403, delete-own 204; the card shows the lock', async () => {
    const s = await newScene(ctx);
    const r = await reply(s, 'signed', 'during');
    await endEvent(ctx, s.eventId);
    expect(outcome(await replyAs(s, 'signed'))).toEqual(
      deny(409, FORUM_THREAD_READ_ONLY),
    );
    expect(outcome(await replyAs(s, 'plain'))).toEqual(
      deny(409, FORUM_THREAD_READ_ONLY),
    );
    expect(outcome(await editAs(s, 'signed', r.id))).toEqual(
      deny(403, FORUM_THREAD_READ_ONLY),
    );
    const card = await as(ctx, 'signed', 'get', ev(s));
    expect(card.body as EventDiscussion).toMatchObject({
      state: 'ready',
      lock: { reason: 'event-ended' },
      can: { read: true, reply: false },
    });
    expect((await deleteAs(s, 'signed', r.id)).status).toBe(204);
    expect(await liveBodies(s)).toEqual([]);
  });
});

describe('ROK-2226 §5.4 — detached thread (event untagged)', () => {
  it('the event route 404s; in the hub the thread is read-only for a signed-up member', async () => {
    const s = await newScene(ctx);
    const r = await reply(s, 'signed', 'before untag');
    await untagEvent(ctx, s.eventId);
    expect(outcome(await as(ctx, 'signed', 'get', `${ev(s)}/thread`))).toEqual(
      deny(404, DISCUSSION_NOT_FOUND),
    );
    const read = await as(ctx, 'signed', 'get', hubThread(s));
    expect(read.status).toBe(200);
    expect((read.body as HubForumThread).lock).toMatchObject({
      reason: 'event-detached',
    });
    const post = await as(ctx, 'signed', 'post', `${hubThread(s)}/replies`, {
      body: 'x',
    });
    expect(outcome(post)).toEqual(deny(409, FORUM_THREAD_READ_ONLY));
    const path = `${hubThread(s)}/replies/${r.id}`;
    const edit = await as(ctx, 'signed', 'patch', path, { body: 'y' });
    expect(outcome(edit)).toEqual(deny(403, FORUM_THREAD_READ_ONLY));
    expect((await as(ctx, 'signed', 'delete', path)).status).toBe(204);
  });
});

describe('ROK-2226 §5.5 — the thread root belongs to the event', () => {
  it.each<Actor>(['officerA', 'admin'])(
    '%s cannot PATCH or DELETE it (403 FORUM_EVENT_THREAD_MANAGED)',
    async (who) => {
      const s = await newScene(ctx);
      const patch = await as(ctx, who, 'patch', hubThread(s), { body: 'x' });
      expect(outcome(patch)).toEqual(deny(403, FORUM_EVENT_THREAD_MANAGED));
      const del = await as(ctx, who, 'delete', hubThread(s));
      expect(outcome(del)).toEqual(deny(403, FORUM_EVENT_THREAD_MANAGED));
      const still = await as(ctx, 'plain', 'get', hubThread(s));
      expect((still.body as HubForumThread).deleted).toBeNull();
    },
  );
});

describe('ROK-2226 §13 AC12 — D7: empty event threads stay out of the list', () => {
  it('list and /latest show the replied event thread (event + lock) and the normal one only', async () => {
    const s = await newScene(ctx);
    const empties: number[] = [];
    for (let i = 0; i < 3; i++) {
      empties.push(await addEventThread(ctx, s.guildId));
    }
    await reply(s, 'signed', 'the only reply');
    const normal = await as(
      ctx,
      'plain',
      'post',
      `/guilds/${s.guildId}/forum`,
      {
        title: 'Loot rules',
        body: 'Thoughts?',
      },
    );
    expect(normal.status).toBe(201);
    const normalId = (normal.body as HubForumThread).id;
    const want = [s.threadId, normalId].sort((a, b) => a - b);
    const list = await as(ctx, 'plain', 'get', `/guilds/${s.guildId}/forum`);
    const rows = (list.body as HubForumThreadList).threads;
    expect(rows.map((t) => t.id).sort((a, b) => a - b)).toEqual(want);
    expect(rows.find((t) => t.id === s.threadId)).toMatchObject({
      event: { id: s.eventId },
      lock: null,
    });
    const latest = await as(
      ctx,
      'plain',
      'get',
      `/guilds/${s.guildId}/forum/latest`,
    );
    const body = latest.body as HubForumLatest;
    expect(body.threads.map((t) => t.id).sort((a, b) => a - b)).toEqual(want);
    expect(body.total).toBe(2);
    expect(new Set(empties).size).toBe(3);
  });
});

describe('ROK-2226 §6.1 — reply throttle', () => {
  it('the 11th reply in a minute is 429', async () => {
    const s = await newScene(ctx);
    for (let i = 0; i < HUB_POST_CREATE_LIMIT; i++) await reply(s, 'signed');
    expect((await replyAs(s, 'signed')).status).toBe(429);
    expect(outcome(await replyAs(s, 'bench')).status).toBe(201);
  });
});
