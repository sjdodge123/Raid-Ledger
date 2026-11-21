/**
 * ROK-2274 — signup lines written into a hub event's Raid Ledger thread,
 * against a real database: an UNBOUND hub gets them (Q1), first sight seeds
 * silently (D4), a repeat flush writes nothing, lines never bump the
 * thread's reply count or activity (D8), a thread-less event gets none
 * (AC2), and a deleted member's line stays with a null subject.
 */
import { and, asc, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { deleteUserTransaction } from '../../../users/users-delete.helpers';
import { bareScene } from '../discord/hub-forum-discord-signup-pings.test-fixtures';
import { EventDiscussionSignupLines } from './event-discussion-signup-lines.service';
import {
  bootDiscussion,
  setSignupStatus,
  signUp,
  untagEvent,
  type DiscussionCtx,
} from './event-discussion.test-fixtures';

const replies = schema.hubForumReplies;
const threads = schema.hubForumThreads;

let ctx: DiscussionCtx;

beforeAll(async () => {
  ctx = await bootDiscussion('edsl');
});

const db = () => ctx.posts.testApp.db;
const flush = (eventId: number) =>
  ctx.posts.testApp.app.get(EventDiscussionSignupLines).flush(eventId);

function lineRows(threadId: number) {
  return db()
    .select()
    .from(replies)
    .where(and(eq(replies.threadId, threadId), eq(replies.kind, 'signup_line')))
    .orderBy(asc(replies.createdAt), asc(replies.id));
}

async function threadCounters(threadId: number) {
  const [t] = nonEmpty(
    await db()
      .select({ n: threads.replyCount, at: threads.lastActivityAt })
      .from(threads)
      .where(eq(threads.id, threadId)),
    'thread',
  );
  return t;
}

async function nameOf(userId: number): Promise<string> {
  const [u] = nonEmpty(
    await db()
      .select({ d: schema.users.displayName, u: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    'user',
  );
  return u.d ?? u.u;
}

describe('ROK-2274 RL signup lines — unbound hub thread', () => {
  it('seeds silently, then writes one line per change and nothing on a repeat', async () => {
    const s = await bareScene(ctx);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect((await flush(s.eventId)).outcome).toBe('seeded');
    expect(await lineRows(s.threadId)).toEqual([]);

    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    expect((await flush(s.eventId)).outcome).toBe('written');
    const rows = await lineRows(s.threadId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'signup_line',
      authorId: null,
      subjectUserId: ctx.ids.tentative,
      guildId: s.guildId,
    });
    expect(rows[0]?.body).toContain(await nameOf(ctx.ids.tentative));
    expect(rows[0]?.body).not.toContain('<@');

    expect((await flush(s.eventId)).outcome).toBe('unchanged');
    expect(await lineRows(s.threadId)).toHaveLength(1);
  });

  it('lines never bump reply_count or last_activity_at (D8)', async () => {
    const s = await bareScene(ctx);
    await flush(s.eventId);
    const before = await threadCounters(s.threadId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect((await flush(s.eventId)).outcome).toBe('written');
    expect(await threadCounters(s.threadId)).toEqual(before);
  });

  it('a member going tentative then declining gets two rows, in order (no merge)', async () => {
    const s = await bareScene(ctx);
    await signUp(ctx, s.eventId, 'declined', 'signed_up');
    await flush(s.eventId);
    await setSignupStatus(ctx, s.eventId, 'declined', 'tentative');
    await flush(s.eventId);
    await setSignupStatus(ctx, s.eventId, 'declined', 'declined');
    await flush(s.eventId);
    const rows = await lineRows(s.threadId);
    expect(rows.map((r) => r.subjectUserId)).toEqual([
      ctx.ids.declined,
      ctx.ids.declined,
    ]);
    expect(rows[0]?.body).not.toBe(rows[1]?.body);
  });
});

describe('ROK-2274 RL signup lines — no live thread', () => {
  it('an event with no live hub thread gets no rows (AC2)', async () => {
    const s = await bareScene(ctx);
    await untagEvent(ctx, s.eventId);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect((await flush(s.eventId)).outcome).toBe('no-thread');
    expect(await lineRows(s.threadId)).toEqual([]);
    const seeded = await db()
      .select()
      .from(schema.hubForumSignupLineStates)
      .where(eq(schema.hubForumSignupLineStates.threadId, s.threadId));
    expect(seeded).toEqual([]);
  });

  it('a cancelled event writes nothing', async () => {
    const s = await bareScene(ctx);
    await flush(s.eventId);
    await db()
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, s.eventId));
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    expect((await flush(s.eventId)).outcome).toBe('cancelled');
    expect(await lineRows(s.threadId)).toEqual([]);
  });
});

describe('ROK-2274 RL signup lines — deleted member', () => {
  it("a deleted user's line stays with a null subject", async () => {
    const s = await bareScene(ctx);
    await flush(s.eventId);
    const [u] = nonEmpty(
      await db()
        .insert(schema.users)
        .values({
          discordId: `local:edsl-gone-${s.eventId}@forum.test`,
          username: `edsl-gone-${s.eventId}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    await db()
      .insert(schema.eventSignups)
      .values({ eventId: s.eventId, userId: u.id, status: 'signed_up' });
    expect((await flush(s.eventId)).outcome).toBe('written');
    await deleteUserTransaction(db(), u.id, ctx.ids.officerA);
    const rows = await lineRows(s.threadId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectUserId).toBeNull();
  });
});
