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
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import {
  planPollSync,
  POLL_CLOSE_GRACE_MS,
  pollSubjectTitle,
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
      })
      .returning(),
    'match',
  );
  return { lineupId: l.id, matchId: m.id };
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
});

describe('pollSubjectTitle (Lead ruling, call 1)', () => {
  const row = { gameName: 'Valheim', lineupTitle: 'Friday raid' };
  it('a standalone poll uses its lineup title; a lineup poll its game', () => {
    expect(pollSubjectTitle({ ...row, standalone: true })).toBe('Friday raid');
    expect(pollSubjectTitle({ ...row, standalone: false })).toBe('Valheim');
  });
});

describe('syncPollDiscussion (real db)', () => {
  it('a standalone hub poll is titled `<poll title> — Poll`', async () => {
    const guildId = await newHub();
    const title = `Standalone ${Date.now()}`;
    const { matchId } = await newPoll({ guildId, standalone: { title } });
    expect(await syncPollDiscussion(testApp.db, matchId)).toBe('insert');
    expect((await liveThread(matchId))?.title).toBe(`${title} — Poll`);
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
