/**
 * ROK-2272 S8 — the poll-deadline pass and the widened lock filter against a
 * real database. `syncExpiredPolls` stamps `write_closes_at` on polls whose
 * deadline passed unobserved (via S7's `syncPollDiscussion`), exempting
 * reschedule polls; `dueLockChanges` then returns poll and lineup thread
 * posts alongside event ones. Every test builds its own hub, lineup and match.
 */
import { randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { dueLockChanges } from '../discord/hub-forum-discord-event-lock';
import { snowflake } from '../discord/hub-forum-discord.test-fixtures';
import {
  findExpiredOpenPollMatchIds,
  syncExpiredPolls,
} from './poll-discussion.deadline';
import {
  POLL_CLOSE_GRACE_MS,
  syncPollDiscussion,
} from './poll-discussion.sync';

const HOUR = 3_600_000;
const threads = schema.hubForumThreads;
let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

async function newHub(): Promise<number> {
  seq += 1;
  const name = `Poll Deadline ${seq} ${Date.now()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function newLineup(guildId: number, phaseDeadline: Date | null) {
  const [l] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Deadline lineup ${seq}`,
        phaseDurationOverride: { standalone: true },
        status: 'decided',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        guildId,
        phaseDeadline,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return l.id;
}

async function newEvent(guildId: number, end: Date): Promise<number> {
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Deadline event',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        guildId,
        isAdHoc: false,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

const hoursAgo = (from: Date, h: number): Date =>
  new Date(from.getTime() - h * HOUR);

/** An open hub poll whose lineup deadline is `deadline`; thread synced at `now`. */
async function openPoll(deadline: Date | null, now: Date, linked = false) {
  const guildId = await newHub();
  const lineupId = await newLineup(guildId, deadline);
  const linkedEventId = linked
    ? await newEvent(guildId, new Date(now.getTime() + 5 * HOUR))
    : null;
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        linkedEventId,
      })
      .returning(),
    'match',
  );
  expect(await syncPollDiscussion(testApp.db, m.id, now)).toBe('insert');
  return { guildId, lineupId, matchId: m.id };
}

async function liveThread(matchId: number) {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(threads)
      .where(
        and(eq(threads.matchId, matchId), isNull(threads.eventDetachedAt)),
      ),
    'poll thread',
  );
  return row;
}

/** Run the pass until it finds nothing (other specs' polls may share the batch). */
async function drain(now: Date): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if ((await syncExpiredPolls(testApp.db, now)) === 0) return;
  }
}

describe('syncExpiredPolls (poll deadline pass)', () => {
  it('stamps deadline + 1 h on an expired standalone poll nobody looked at', async () => {
    const now = new Date();
    const deadline = new Date(now.getTime() - HOUR);
    const { matchId } = await openPoll(deadline, hoursAgo(now, 2));
    expect((await liveThread(matchId)).writeClosesAt).toBeNull();
    await drain(now);
    expect((await liveThread(matchId)).writeClosesAt?.toISOString()).toBe(
      new Date(deadline.getTime() + POLL_CLOSE_GRACE_MS).toISOString(),
    );
  });

  it('stamps now + 1 h when the parent lineup was archived', async () => {
    const now = new Date();
    const { matchId, lineupId } = await openPoll(null, now);
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, lineupId));
    const at = now;
    expect(await findExpiredOpenPollMatchIds(testApp.db, at, 1000)).toContain(
      matchId,
    );
    await drain(at);
    expect((await liveThread(matchId)).writeClosesAt?.toISOString()).toBe(
      new Date(at.getTime() + POLL_CLOSE_GRACE_MS).toISOString(),
    );
  });

  it('leaves a reschedule poll (match tied to an event) open past the deadline', async () => {
    const now = new Date();
    const { matchId } = await openPoll(
      hoursAgo(now, 1),
      hoursAgo(now, 2),
      true,
    );
    expect(
      await findExpiredOpenPollMatchIds(testApp.db, now, 1000),
    ).not.toContain(matchId);
    await drain(now);
    expect((await liveThread(matchId)).writeClosesAt).toBeNull();
  });

  it('leaves an open poll before its deadline untouched', async () => {
    const now = new Date();
    const { matchId } = await openPoll(new Date(now.getTime() + HOUR), now);
    const at = now;
    expect(
      await findExpiredOpenPollMatchIds(testApp.db, at, 1000),
    ).not.toContain(matchId);
    await drain(at);
    expect((await liveThread(matchId)).writeClosesAt).toBeNull();
  });
});

/** Bind the hub to a fresh forum, bound a minute ago. */
async function bind(guildId: number): Promise<void> {
  const [f] = nonEmpty(
    await testApp.db
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: snowflake(), channelId: snowflake() })
      .returning({ id: schema.hubForumDiscordForums.id }),
    'forum',
  );
  const at = new Date(Date.now() - 60_000);
  await testApp.db
    .insert(schema.hubForumDiscordBindings)
    .values({ guildId, forumId: f.id, tagId: null, ackAt: at, boundAt: at });
}

/** A sent Discord post for `threadId`. */
async function link(guildId: number, threadId: number): Promise<void> {
  const id = snowflake();
  await testApp.db.insert(schema.hubForumDiscordLinks).values({
    guildId,
    kind: 'thread',
    threadId,
    replyId: null,
    discordThreadId: id,
    discordMessageId: id,
    origin: 'raidledger',
    syncState: 'synced',
  });
}

/** A subject thread inserted directly, closed an hour ago. */
async function closedThread(
  guildId: number,
  subject: { eventId: number } | { lineupId: number },
): Promise<number> {
  const [t] = nonEmpty(
    await testApp.db
      .insert(threads)
      .values({
        guildId,
        authorId: testApp.seed.adminUser.id,
        title: 'Closed subject',
        body: 'body',
        writeClosesAt: new Date(Date.now() - HOUR),
        ...subject,
      })
      .returning({ id: threads.id }),
    'thread',
  );
  return t.id;
}

/**
 * Thread ids `dueLockChanges` reports read-only at `now`. Rows from other
 * specs may fill a batch, so each batch is recorded as the sweep would.
 */
async function dueReadOnly(now: Date): Promise<number[]> {
  const seen: number[] = [];
  const l = schema.hubForumDiscordLinks;
  for (let i = 0; i < 20; i += 1) {
    const rows = await dueLockChanges(testApp.db, now);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.readOnly) seen.push(r.threadId);
      await testApp.db
        .update(l)
        .set({ discordLockedAt: r.readOnly ? now : null })
        .where(eq(l.id, r.linkId));
    }
  }
  return seen;
}

describe('dueLockChanges covers every subject (ROK-2272 S8)', () => {
  it('returns a poll post once its stamped close time is past', async () => {
    const now = new Date();
    const { matchId, guildId } = await openPoll(
      hoursAgo(now, 2),
      hoursAgo(now, 3),
    );
    await bind(guildId);
    const thread = await liveThread(matchId);
    await link(guildId, thread.id);
    // Deadline 2 h ago ⇒ stamped close 1 h ago: not due until the pass ran.
    expect(await dueReadOnly(now)).not.toContain(thread.id);
    await drain(now);
    expect(await dueReadOnly(now)).toContain(thread.id);
  });

  it('returns a closed lineup-thread post and still a closed event-thread post', async () => {
    const guildId = await newHub();
    await bind(guildId);
    const lineupThread = await closedThread(guildId, {
      lineupId: await newLineup(guildId, null),
    });
    const eventThread = await closedThread(guildId, {
      eventId: await newEvent(guildId, new Date(Date.now() - 3 * HOUR)),
    });
    await link(guildId, lineupThread);
    await link(guildId, eventThread);
    const due = await dueReadOnly(new Date());
    expect(due).toContain(lineupThread);
    expect(due).toContain(eventThread);
  });
});

describe('ROK-2314 an event post is read-only while its reschedule poll runs', () => {
  async function setRescheduling(eventId: number, pollId: number | null) {
    await testApp.db
      .update(schema.events)
      .set({ reschedulingPollId: pollId })
      .where(eq(schema.events.id, eventId));
  }

  /** A linked event thread closing in `closesInMs`, its event rescheduling. */
  async function reschedulingPost(closesInMs: number) {
    const guildId = await newHub();
    await bind(guildId);
    const eventId = await newEvent(guildId, new Date(Date.now() + 5 * HOUR));
    await setRescheduling(eventId, 1);
    const [t] = nonEmpty(
      await testApp.db
        .insert(threads)
        .values({
          guildId,
          authorId: testApp.seed.adminUser.id,
          title: 'Rescheduling subject',
          body: 'body',
          writeClosesAt: new Date(Date.now() + closesInMs),
          eventId,
        })
        .returning({ id: threads.id }),
      'thread',
    );
    await link(guildId, t.id);
    return { eventId, threadId: t.id };
  }

  async function lockLink(threadId: number): Promise<void> {
    const l = schema.hubForumDiscordLinks;
    await testApp.db
      .update(l)
      .set({ discordLockedAt: new Date() })
      .where(eq(l.threadId, threadId));
  }

  /** The due flip for this event's post (undefined = not due). */
  async function dueFor(eventId: number, threadId: number) {
    const rows = await dueLockChanges(testApp.db, new Date(), eventId);
    expect(rows.every((r) => r.eventId === eventId)).toBe(true);
    return rows.find((r) => r.threadId === threadId)?.readOnly;
  }

  it('an open post whose event is rescheduling is due to close', async () => {
    const { eventId, threadId } = await reschedulingPost(HOUR);
    expect(await dueFor(eventId, threadId)).toBe(true);
  });

  it('cleared with a future close: the locked post is due to reopen', async () => {
    const { eventId, threadId } = await reschedulingPost(HOUR);
    await lockLink(threadId);
    expect(await dueFor(eventId, threadId)).toBeUndefined();
    await setRescheduling(eventId, null);
    expect(await dueFor(eventId, threadId)).toBe(false);
  });

  it('cleared with a past close: the locked post stays closed', async () => {
    const { eventId, threadId } = await reschedulingPost(-HOUR);
    await lockLink(threadId);
    await setRescheduling(eventId, null);
    expect(await dueFor(eventId, threadId)).toBeUndefined();
  });
});
