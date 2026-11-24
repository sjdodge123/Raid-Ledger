/**
 * ROK-2272 S7a — the scheduling-poll discussion lifecycle against a real
 * database (spec §3.1, §3.6, §3.7; R4, R6, R8, R11). Opens / lock-ins /
 * cancels go through the real EventEmitter2 (the S6 emits) into
 * `PollDiscussionListener`; idempotency, private and unhub cases call the
 * reconciler directly. Every test builds its own hub, lineup and match.
 */
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, isNull } from 'drizzle-orm';
import { POST_EVENT_FOLLOWUP_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { LINEUP_LIFECYCLE_EVENTS } from '../../../lineups/lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { findPollForSync } from './poll-discussion.queries';
import {
  planPollSync,
  POLL_CLOSE_GRACE_MS,
  pollWriteClosesAt,
  pollThreadTitle,
  syncPollDiscussion,
} from './poll-discussion.sync';

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

const emitter = () => testApp.app.get(EventEmitter2);
const threads = schema.hubForumThreads;

async function newHub(): Promise<number> {
  seq += 1;
  const name = `Poll Discussion ${seq} ${Date.now()}`;
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

interface PollOpts {
  guildId?: number | null;
  visibility?: 'public' | 'private';
  status?: 'suggested' | 'scheduling' | 'scheduled' | 'archived';
  /** A standalone poll's storage lineup (`phase_duration_override.standalone`). */
  standalone?: { title: string };
  /** ROK-2295: the event this poll reschedules (`linked_event_id`). */
  linkedEventId?: number;
  /** ROK-2315: the lineup's `phase_deadline` (a plain poll's close date). */
  phaseDeadline?: Date;
}

/** A decided lineup with one match (the poll). */
async function newPoll(opts: PollOpts = {}) {
  const [l] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: opts.standalone?.title ?? `Poll lineup ${seq}`,
        ...(opts.standalone
          ? { phaseDurationOverride: { standalone: true } }
          : {}),
        status: 'decided',
        visibility: opts.visibility ?? 'public',
        createdBy: testApp.seed.adminUser.id,
        guildId: opts.guildId ?? null,
        phaseDeadline: opts.phaseDeadline ?? null,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: l.id,
        gameId: testApp.seed.game.id,
        status: opts.status ?? 'scheduling',
        linkedEventId: opts.linkedEventId ?? null,
      })
      .returning(),
    'match',
  );
  return { lineupId: l.id, matchId: m.id };
}

/** ROK-2295: an event (optionally created from `fromPollId` at lock-in). */
async function newEvent(title: string, fromPollId?: number): Promise<number> {
  const start = new Date(Date.now() + 86_400_000);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + 7_200_000)] as [
          Date,
          Date,
        ],
        ...(fromPollId === undefined ? {} : { createdFromPollId: fromPollId }),
      })
      .returning(),
    'event',
  );
  return e.id;
}

/** ROK-2301: the follow-up prompt row that opened poll `matchId`. */
async function newFollowup(eventId: number, matchId: number): Promise<void> {
  await testApp.db
    .insert(schema.postEventFollowupSent)
    .values({ eventId, matchId, choice: 'poll' });
}

const threadRows = (matchId: number) =>
  testApp.db.select().from(threads).where(eq(threads.matchId, matchId));

async function liveThread(matchId: number) {
  const [row] = await testApp.db
    .select()
    .from(threads)
    .where(and(eq(threads.matchId, matchId), isNull(threads.eventDetachedAt)));
  return row;
}

const setMatch = (matchId: number, status: 'scheduled' | 'archived') =>
  testApp.db
    .update(schema.communityLineupMatches)
    .set({ status })
    .where(eq(schema.communityLineupMatches.id, matchId));

describe('planPollSync (decision table)', () => {
  const base = {
    matchId: 1,
    lineupId: 1,
    creatorId: 1,
    gameName: 'g',
    lineupTitle: 'L',
    standalone: false,
    guildId: 7,
    visibility: 'public' as const,
    lineupStatus: 'decided' as const,
    phaseDeadline: null,
    linkedEventId: null,
    linkedEventTitle: null,
    followupOfEventTitle: null,
  };
  it('inserts only for an open hub poll', () => {
    expect(planPollSync({ ...base, status: 'scheduling' }, null)).toBe(
      'insert',
    );
    expect(planPollSync({ ...base, status: 'scheduled' }, null)).toBe('noop');
    expect(planPollSync({ ...base, status: 'suggested' }, null)).toBe('noop');
  });
  it('detaches a thread whose poll is private, unhubbed or gone', () => {
    const th = { guildId: 7 };
    const open = { ...base, status: 'scheduling' as const };
    expect(planPollSync({ ...open, visibility: 'private' }, th)).toBe('detach');
    expect(planPollSync({ ...open, guildId: null }, th)).toBe('detach');
    expect(planPollSync(null, th)).toBe('detach');
    expect(planPollSync({ ...open, guildId: 8 }, th)).toBe('move');
  });
  it('a scheduling poll whose lineup ended is closed (Codex A)', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const open = { ...base, status: 'scheduling' as const };
    const archived = { ...open, lineupStatus: 'archived' as const };
    const past = new Date(now.getTime() - 60_000);
    const expired = { ...open, phaseDeadline: past };
    const future = { ...open, phaseDeadline: new Date(now.getTime() + 1) };
    expect(planPollSync(archived, null, now)).toBe('noop');
    expect(planPollSync(expired, null, now)).toBe('noop');
    expect(planPollSync(future, null, now)).toBe('insert');
    expect(pollWriteClosesAt(archived, null, now)?.getTime()).toBe(
      now.getTime() + POLL_CLOSE_GRACE_MS,
    );
    expect(pollWriteClosesAt(expired, null, now)?.getTime()).toBe(
      past.getTime() + POLL_CLOSE_GRACE_MS,
    );
    expect(pollWriteClosesAt(future, null, now)).toBeNull();
  });
  it('a reschedule poll (linked event) stays open past its lineup', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const linked = { ...base, status: 'scheduling' as const, linkedEventId: 9 };
    const archived = { ...linked, lineupStatus: 'archived' as const };
    const expired = { ...linked, phaseDeadline: new Date(now.getTime() - 1) };
    expect(planPollSync(archived, null, now)).toBe('insert');
    expect(pollWriteClosesAt(archived, null, now)).toBeNull();
    expect(pollWriteClosesAt(expired, null, now)).toBeNull();
    expect(
      pollWriteClosesAt({ ...archived, status: 'scheduled' }, null, now),
    ).not.toBeNull();
  });
});

describe('syncPollDiscussion (real db)', () => {
  it('ROK-2295: a standalone hub poll is titled by its game, never the storage title', async () => {
    const guildId = await newHub();
    const title = 'Standalone Scheduling Poll';
    const { matchId } = await newPoll({ guildId, standalone: { title } });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    expect((await liveThread(matchId))?.title).toBe(
      `${testApp.seed.game.name} — Poll`,
    );
  });

  it('ROK-2315: a plain poll with a deadline leads with its close date, and follows a deadline change', async () => {
    const guildId = await newHub();
    // Noon UTC: the same calendar day in any community timezone.
    const phaseDeadline = new Date('2099-01-15T12:00:00Z');
    const { matchId, lineupId } = await newPoll({ guildId, phaseDeadline });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    expect((await liveThread(matchId))?.title).toBe(
      `Poll · closes Thu 15 Jan — ${testApp.seed.game.name}`,
    );
    await testApp.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: new Date('2099-01-22T12:00:00Z') })
      .where(eq(schema.communityLineups.id, lineupId));
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect((await liveThread(matchId))?.title).toBe(
      `Poll · closes Thu 22 Jan — ${testApp.seed.game.name}`,
    );
  });

  it('ROK-2315: the close date is read in the community timezone (DEFAULT_TIMEZONE)', async () => {
    const settings = testApp.app.get(SettingsService);
    const zoneKey = schema.SETTING_KEYS.DEFAULT_TIMEZONE;
    const before = await settings.get(zoneKey);
    await settings.set(zoneKey, 'America/New_York');
    try {
      const guildId = await newHub();
      // 02:00Z Fri 16 Jan is 21:00 Thu 15 Jan in New York.
      const phaseDeadline = new Date('2099-01-16T02:00:00Z');
      const { matchId } = await newPoll({ guildId, phaseDeadline });
      expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
      expect((await liveThread(matchId))?.title).toBe(
        `Poll · closes Thu 15 Jan — ${testApp.seed.game.name}`,
      );
    } finally {
      // Restore so every other spec keeps reading UTC.
      if (before === null) await settings.delete(zoneKey);
      else await settings.set(zoneKey, before);
    }
  });

  it('ROK-2295: a reschedule poll is "Reschedule: <event> — Poll"', async () => {
    const guildId = await newHub();
    const eventId = await newEvent('Thursday Raid');
    const { matchId } = await newPoll({
      guildId,
      standalone: { title: 'Standalone Scheduling Poll' },
      linkedEventId: eventId,
    });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    const thread = await liveThread(matchId);
    expect(thread?.title).toBe('Reschedule: Thursday Raid — Poll');
  });

  it('ROK-2295: an old storage-titled thread is retitled on its next sync', async () => {
    const guildId = await newHub();
    const title = 'Standalone Scheduling Poll';
    const { matchId } = await newPoll({ guildId, standalone: { title } });
    await syncPollDiscussion(testApp.db, matchId);
    await testApp.db
      .update(threads)
      .set({ title: `${title} — Poll` })
      .where(eq(threads.matchId, matchId));
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect((await liveThread(matchId))?.title).toBe(
      `${testApp.seed.game.name} — Poll`,
    );
  });

  it('ROK-2301: findPollForSync reads the follow-up source event title', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId });
    expect(
      (await findPollForSync(testApp.db, matchId))?.followupOfEventTitle,
    ).toBeNull();
    const eventId = await newEvent('Tuesday Dungeon Night');
    await newFollowup(eventId, matchId);
    const poll = await findPollForSync(testApp.db, matchId);
    expect(poll?.followupOfEventTitle).toBe('Tuesday Dungeon Night');
    expect(poll?.linkedEventId).toBeNull();
  });

  it('ROK-2315: a follow-up poll thread is "<event> — Follow-up poll"', async () => {
    const guildId = await newHub();
    const title = 'Standalone Scheduling Poll';
    const { matchId } = await newPoll({ guildId, standalone: { title } });
    await newFollowup(await newEvent('Tuesday Dungeon Night'), matchId);
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    expect((await liveThread(matchId))?.title).toBe(
      'Tuesday Dungeon Night — Follow-up poll',
    );
  });

  it('ROK-2301: an existing "<game> — Poll" thread is renamed on its next sync', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId });
    await syncPollDiscussion(testApp.db, matchId);
    expect((await liveThread(matchId))?.title).toBe(
      `${testApp.seed.game.name} — Poll`,
    );
    await newFollowup(await newEvent('Tuesday Dungeon Night'), matchId);
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect((await liveThread(matchId))?.title).toBe(
      'Tuesday Dungeon Night — Follow-up poll',
    );
  });

  it('ROK-2301 MAJOR-1: production order, opened then recorded then POLL_LINKED', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    const endedEventId = await newEvent('Tuesday Dungeon Night');
    await testApp.db
      .insert(schema.postEventFollowupSent)
      .values({ eventId: endedEventId, choice: 'poll' });
    emitter().emit(LINEUP_MATCH_EVENTS.POLL_OPENED, {
      matchId,
      lineupId,
      guildId,
      visibility: 'public',
    });
    await waitFor(async () => {
      expect((await liveThread(matchId))?.title).toBe(
        `${testApp.seed.game.name} — Poll`,
      );
    }, 5000);
    await testApp.db
      .update(schema.postEventFollowupSent)
      .set({ matchId })
      .where(eq(schema.postEventFollowupSent.eventId, endedEventId));
    emitter().emit(POST_EVENT_FOLLOWUP_EVENTS.POLL_LINKED, {
      matchId,
      endedEventId,
    });
    await waitFor(async () => {
      expect((await liveThread(matchId))?.title).toBe(
        'Tuesday Dungeon Night — Follow-up poll',
      );
    }, 5000);
    expect(await threadRows(matchId)).toHaveLength(1);
  });

  it('ROK-2301 MINOR-1: two follow-up rows on one match, the newest names it, one poll row', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId });
    await newFollowup(await newEvent('Older Raid'), matchId);
    await newFollowup(await newEvent('Newer Raid'), matchId);
    for (let i = 0; i < 3; i += 1) {
      const poll = await findPollForSync(testApp.db, matchId);
      expect(poll?.matchId).toBe(matchId);
      expect(poll?.followupOfEventTitle).toBe('Newer Raid');
    }
  });

  it('ROK-2295: a poll that produced its event keeps its game title', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId });
    await syncPollDiscussion(testApp.db, matchId);
    const eventId = await newEvent('Created Raid', matchId);
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled', linkedEventId: eventId })
      .where(eq(schema.communityLineupMatches.id, matchId));
    await syncPollDiscussion(testApp.db, matchId);
    expect((await liveThread(matchId))?.title).toBe(
      `${testApp.seed.game.name} — Poll`,
    );
  });

  it('a hub poll opening creates exactly one thread with match_id (R4, R11)', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    emitter().emit(LINEUP_MATCH_EVENTS.POLL_OPENED, {
      matchId,
      lineupId,
      guildId,
      visibility: 'public',
    });
    await waitFor(async () => {
      expect(await threadRows(matchId)).toHaveLength(1);
    }, 5000);
    const t = await liveThread(matchId);
    expect(t).toMatchObject({
      guildId,
      matchId,
      eventId: null,
      lineupId: null,
      authorId: testApp.seed.adminUser.id,
      title: pollThreadTitle(testApp.seed.game.name),
      writeClosesAt: null,
    });
    expect(t?.title.endsWith(' — Poll')).toBe(true);
  });

  it('a second sync is a refresh no-op — still one thread', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect(await threadRows(matchId)).toHaveLength(1);
  });

  it('a poll with no hub gets no thread', async () => {
    const { matchId } = await newPoll({ guildId: null });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('noop');
    expect(await threadRows(matchId)).toHaveLength(0);
  });

  it('a private hub poll gets no thread (§3.7)', async () => {
    const guildId = await newHub();
    const { matchId } = await newPoll({ guildId, visibility: 'private' });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('noop');
    expect(await threadRows(matchId)).toHaveLength(0);
  });
});

describe('syncPollDiscussion close + detach (real db)', () => {
  it('public → private closes and detaches the thread (R6)', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    await syncPollDiscussion(testApp.db, matchId);
    await testApp.db
      .update(schema.communityLineups)
      .set({ visibility: 'private' })
      .where(eq(schema.communityLineups.id, lineupId));
    const now = new Date();
    expect(await syncPollDiscussion(testApp.db, matchId, now)).toBe('detach');
    const rows = await threadRows(matchId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventDetachedAt?.getTime()).toBe(now.getTime());
    expect(rows[0]?.writeClosesAt?.getTime()).toBe(now.getTime());
    expect(await liveThread(matchId)).toBeUndefined();
  });

  it.each([
    ['lock-in', 'scheduled', LINEUP_MATCH_EVENTS.POLL_LOCKED_IN],
    ['cancel', 'archived', LINEUP_MATCH_EVENTS.POLL_CANCELLED],
  ] as const)(
    '%s sets write_closes_at ≈ now + 1 h (R1/R2)',
    async (_what, status, event) => {
      const guildId = await newHub();
      const { matchId, lineupId } = await newPoll({ guildId });
      await syncPollDiscussion(testApp.db, matchId);
      await setMatch(matchId, status);
      const before = Date.now();
      emitter().emit(event, { matchId, lineupId, eventId: null, reason: null });
      await waitFor(async () => {
        expect((await liveThread(matchId))?.writeClosesAt).toBeInstanceOf(Date);
      }, 5000);
      const closes = (await liveThread(matchId))?.writeClosesAt?.getTime();
      expect(closes).toBeGreaterThanOrEqual(before + POLL_CLOSE_GRACE_MS);
      expect(closes).toBeLessThanOrEqual(Date.now() + POLL_CLOSE_GRACE_MS);
      // A later sync keeps the first deadline (idempotent).
      await syncPollDiscussion(testApp.db, matchId, new Date(before + 600_000));
      expect((await liveThread(matchId))?.writeClosesAt?.getTime()).toBe(
        closes,
      );
    },
  );
});

describe('syncPollDiscussion — parent lineup ended (Codex A, real db)', () => {
  const setLineup = (
    lineupId: number,
    set: { status?: 'decided' | 'archived'; phaseDeadline?: Date | null },
  ) =>
    testApp.db
      .update(schema.communityLineups)
      .set(set)
      .where(eq(schema.communityLineups.id, lineupId));

  it('lineup archived with the match still scheduling closes in 1 h; reopening clears it', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    await syncPollDiscussion(testApp.db, matchId);
    await setLineup(lineupId, { status: 'archived' });
    const before = Date.now();
    emitter().emit(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, {
      lineupId,
      from: 'decided',
      to: 'archived',
    });
    await waitFor(async () => {
      expect((await liveThread(matchId))?.writeClosesAt).toBeInstanceOf(Date);
    }, 5000);
    const closes = (await liveThread(matchId))?.writeClosesAt?.getTime();
    expect(closes).toBeGreaterThanOrEqual(before + POLL_CLOSE_GRACE_MS);
    expect(closes).toBeLessThanOrEqual(Date.now() + POLL_CLOSE_GRACE_MS);
    await setLineup(lineupId, { status: 'decided' });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect((await liveThread(matchId))?.writeClosesAt).toBeNull();
  });

  it('a passed phase_deadline closes 1 h after the deadline', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    await syncPollDiscussion(testApp.db, matchId);
    const deadline = new Date(Date.now() - 10 * 60_000);
    await setLineup(lineupId, { phaseDeadline: deadline });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('refresh');
    expect((await liveThread(matchId))?.writeClosesAt?.getTime()).toBe(
      deadline.getTime() + POLL_CLOSE_GRACE_MS,
    );
  });

  it('an already-ended poll never gets a fresh thread', async () => {
    const guildId = await newHub();
    const { matchId, lineupId } = await newPoll({ guildId });
    await setLineup(lineupId, { status: 'archived' });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('noop');
    expect(await threadRows(matchId)).toHaveLength(0);
  });
});
