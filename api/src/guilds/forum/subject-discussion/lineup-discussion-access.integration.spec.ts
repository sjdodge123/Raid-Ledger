/**
 * ROK-2272 S7b — the R7 lineup-thread matrix through the R10 routes
 * (`lineups/:id/discussion`) and the hub forum routes against a real
 * database: read (card) / reply, the read-only lock (decided + deadline
 * passed), reopen, and the 404s (unknown, private, hub-less, standalone
 * carrier). Each test builds its own hub + lineup.
 * Actors (from the event fixtures): `signed` = hub member who nominated,
 * `tentative` = hub member who did neither, `pug` = voted only, outside the
 * hub, `outsider` = neither.
 */
import { randomBytes } from 'crypto';
import type { HubForumThread, SubjectDiscussion } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { link, newHub } from '../../posts/hub-posts.test-fixtures';
import {
  FORUM_EVENT_THREAD_MANAGED,
  FORUM_THREAD_READ_ONLY,
} from '../event-discussion/event-discussion.access';
import {
  as,
  bootDiscussion,
  outcome,
  resetThrottles,
  type Actor,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { LineupDiscussionReplyThrottleGuard } from './lineup-discussion-throttle.guard';
import { FORUM_NOT_LINEUP_PARTICIPANT } from './lineup-discussion.access';
import { LINEUP_NOT_FOUND } from './lineup-discussion.service';

let ctx: DiscussionCtx;

beforeAll(async () => {
  ctx = await bootDiscussion('lineupdisc');
});

beforeEach(() => {
  resetThrottles(ctx);
  const app = ctx.posts.testApp.app;
  app.get(LineupDiscussionReplyThrottleGuard, { strict: false }).reset();
});

const db = () => ctx.posts.testApp.db;
const route = (lineupId: number) => `/lineups/${lineupId}/discussion`;
type Status = 'building' | 'voting' | 'decided' | 'archived';

interface LineupOpts {
  guildId: number | null;
  visibility?: 'public' | 'private';
  standalone?: boolean;
}

async function newLineup(opts: LineupOpts): Promise<number> {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `Lineup access ${Date.now()}`,
        status: 'voting',
        visibility: opts.visibility ?? 'public',
        createdBy: ctx.ids.admin,
        guildId: opts.guildId,
        publicSlug: randomBytes(8).toString('hex'),
        ...(opts.standalone
          ? { phaseDurationOverride: { standalone: true } }
          : {}),
      })
      .returning(),
    'lineup',
  );
  return l.id;
}

/** `signed` nominates the seed game; `pug` votes for it (no nomination). */
async function seedParticipants(lineupId: number): Promise<void> {
  const gameId = ctx.posts.testApp.seed.game.id;
  await db()
    .insert(schema.communityLineupEntries)
    .values({ lineupId, gameId, nominatedBy: ctx.ids.signed });
  await db()
    .insert(schema.communityLineupVotes)
    .values({ lineupId, gameId, userId: ctx.ids.pug });
}

/** A hub (members: `signed`, `tentative`) with an open public lineup. */
async function hubLineup(): Promise<number> {
  const guildId = await newHub(ctx.posts);
  for (const who of ['signed', 'tentative'] as const) {
    await link(ctx.posts, guildId, ctx.ids[who]);
  }
  const lineupId = await newLineup({ guildId });
  await seedParticipants(lineupId);
  return lineupId;
}

async function setStatus(lineupId: number, status: Status): Promise<void> {
  await db()
    .update(schema.communityLineups)
    .set({ status })
    .where(eq(schema.communityLineups.id, lineupId));
}

/**
 * Decide the lineup FIRST, then backdate the deadline: backdating while it
 * is still `voting` would be cleared by the GET's sync (reopen rule).
 */
async function closeLineup(lineupId: number): Promise<void> {
  await setStatus(lineupId, 'decided');
  await db()
    .update(schema.hubForumThreads)
    .set({ writeClosesAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.hubForumThreads.lineupId, lineupId));
}

async function card(lineupId: number, who: Actor): Promise<SubjectDiscussion> {
  const res = await as(ctx, who, 'get', route(lineupId));
  expect(outcome(res)).toEqual({ status: 200, message: undefined });
  return res.body as SubjectDiscussion;
}

const replyAs = (lineupId: number, who: Actor) =>
  as(ctx, who, 'post', `${route(lineupId)}/replies`, { body: 'hi' });

/** The hub-route path of the lineup's live thread (GET the card first). */
async function hubThreadPath(lineupId: number): Promise<string> {
  const [t] = nonEmpty(
    await db()
      .select()
      .from(schema.hubForumThreads)
      .where(eq(schema.hubForumThreads.lineupId, lineupId)),
    'lineup thread',
  );
  return `/guilds/${t.guildId}/forum/${t.id}`;
}

const notParticipant = { status: 403, message: FORUM_NOT_LINEUP_PARTICIPANT };

describe('lineup discussion access (R7, R10)', () => {
  it('a hub member who nominated reads and replies; the GET lazily creates the thread', async () => {
    const lineupId = await hubLineup();
    expect(await card(lineupId, 'signed')).toMatchObject({
      state: 'ready',
      kind: 'lineup',
      can: { read: true, reply: true },
      member: true,
    });
    expect(outcome(await replyAs(lineupId, 'signed')).status).toBe(201);
    const after = await card(lineupId, 'signed');
    expect(after.state === 'ready' && after.replyCount).toBe(1);
  });

  it('a voter (voted only) outside the hub reads and replies', async () => {
    const lineupId = await hubLineup();
    expect(await card(lineupId, 'pug')).toMatchObject({
      can: { read: true, reply: true },
      member: false,
    });
    expect(outcome(await replyAs(lineupId, 'pug')).status).toBe(201);
  });

  it('a hub member who neither nominated nor voted reads but may not reply (403)', async () => {
    const lineupId = await hubLineup();
    expect(await card(lineupId, 'tentative')).toMatchObject({
      can: { read: true, reply: false },
    });
    expect(outcome(await replyAs(lineupId, 'tentative'))).toEqual(
      notParticipant,
    );
  });

  it('an outsider neither reads nor replies (403 with the lineup copy)', async () => {
    const lineupId = await hubLineup();
    expect(await card(lineupId, 'outsider')).toMatchObject({
      can: { read: false, reply: false },
      latestReplies: [],
    });
    expect(outcome(await replyAs(lineupId, 'outsider'))).toEqual(
      notParticipant,
    );
  });
});

describe('lineup discussion refusals (R7, §3.1, §3.7)', () => {
  it('a decided lineup past its deadline reads but refuses replies (409)', async () => {
    const lineupId = await hubLineup();
    await card(lineupId, 'signed');
    await closeLineup(lineupId);
    const c = await card(lineupId, 'signed');
    expect(c).toMatchObject({ can: { read: true, reply: false } });
    expect(c.state === 'ready' && c.lock?.reason).toBe('event-ended');
    expect(outcome(await replyAs(lineupId, 'signed'))).toEqual({
      status: 409,
      message: FORUM_THREAD_READ_ONLY,
    });
  });

  it('reopening a decided lineup clears the deadline: replies are allowed again', async () => {
    const lineupId = await hubLineup();
    await card(lineupId, 'signed');
    await closeLineup(lineupId);
    expect(outcome(await replyAs(lineupId, 'signed')).status).toBe(409);
    await setStatus(lineupId, 'voting');
    const c = await card(lineupId, 'signed');
    expect(c).toMatchObject({ can: { read: true, reply: true } });
    expect(c.state === 'ready' && c.lock).toBeNull();
    expect(outcome(await replyAs(lineupId, 'signed')).status).toBe(201);
  });

  it('an unknown lineup id is 404 on both routes (no existence leak)', async () => {
    const notFound = { status: 404, message: LINEUP_NOT_FOUND };
    const missing = 2_000_000_000;
    expect(outcome(await as(ctx, 'signed', 'get', route(missing)))).toEqual(
      notFound,
    );
    expect(outcome(await replyAs(missing, 'signed'))).toEqual(notFound);
  });

  it('a private, a hub-less and a standalone-carrier lineup are 404 on both routes', async () => {
    const guildId = await newHub(ctx.posts);
    const ids = [
      await newLineup({ guildId, visibility: 'private' }),
      await newLineup({ guildId: null }),
      await newLineup({ guildId, standalone: true }),
    ];
    const notFound = { status: 404, message: LINEUP_NOT_FOUND };
    for (const lineupId of ids) {
      expect(outcome(await as(ctx, 'signed', 'get', route(lineupId)))).toEqual(
        notFound,
      );
      expect(outcome(await replyAs(lineupId, 'signed'))).toEqual(notFound);
    }
  });
});

describe('lineup thread through the hub forum routes (§5.5, R7)', () => {
  it.each<Actor>(['admin', 'officerA'])(
    '%s (creator / hub officer) cannot PATCH or DELETE the root (403 managed)',
    async (who) => {
      const lineupId = await hubLineup();
      await card(lineupId, 'signed');
      const path = await hubThreadPath(lineupId);
      const managed = { status: 403, message: FORUM_EVENT_THREAD_MANAGED };
      const patch = await as(ctx, who, 'patch', path, { body: 'x' });
      expect(outcome(patch)).toEqual(managed);
      expect(outcome(await as(ctx, who, 'delete', path))).toEqual(managed);
      const still = await db()
        .select()
        .from(schema.hubForumThreads)
        .where(eq(schema.hubForumThreads.lineupId, lineupId));
      expect(still.map((t) => t.deletedAt)).toEqual([null]);
    },
  );

  it('the hub thread view gives its author no edit/delete on the managed root', async () => {
    const lineupId = await hubLineup();
    await card(lineupId, 'signed');
    const res = await as(ctx, 'admin', 'get', await hubThreadPath(lineupId));
    expect(res.status).toBe(200);
    const view = res.body as HubForumThread;
    expect(view.author?.userId).toBe(ctx.ids.admin);
    expect(view.can).toMatchObject({ edit: false, delete: false });
  });

  it('R7 holds on the hub reply route: a nominator posts (201), a non-participant member is 403', async () => {
    const lineupId = await hubLineup();
    await card(lineupId, 'signed');
    const replies = `${await hubThreadPath(lineupId)}/replies`;
    const post = (who: Actor) => as(ctx, who, 'post', replies, { body: 'x' });
    expect(outcome(await post('signed')).status).toBe(201);
    expect(outcome(await post('tentative'))).toEqual(notParticipant);
  });
});
