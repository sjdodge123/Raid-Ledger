/**
 * ROK-1940 (AC-2, AC-3): migration 0279 backfills "short late joiners count
 * as late" over voice-derived history only.
 *
 * Seeds OLD-shape rows — attendance_status set, attendance_source NULL (the
 * state before 0278/0279) — on a past 60-minute event, then re-executes
 * 0279's statements against the test DB (precedent:
 * users/game-time-absence-span.integration.spec.ts runCapMigration).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { queryUserReliability } from '../../events/analytics-queries.helpers';
import { findDesiredMembers } from '../game-roles/game-role-desired.helpers';

const MIN = 60_000;
/** Whole-minute start so tsrange and timestamp compare without ms drift. */
const START = new Date(Math.floor((Date.now() - 3 * 60 * MIN) / MIN) * MIN);
const END = new Date(START.getTime() + 60 * MIN);

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Run migration 0279's statements against the current test DB. */
async function runBackfill(): Promise<void> {
  const file = join(
    __dirname,
    '../../drizzle/migrations/0279_voice_attendance_late_backfill.sql',
  );
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

interface VoiceSeed {
  joinOffsetMin: number;
  totalSec: number;
  classification: string;
}

interface CaseSeed {
  /** Signup's attendance_status before the migration (null = unmarked). */
  status: string | null;
  voice: VoiceSeed | null;
  /** 'user' leaves the signup's discord_user_id NULL so only user_id matches. */
  matchBy: 'discord' | 'user';
  /** false = a voice row with no signup at all. */
  hasSignup?: boolean;
  /** Pre-set provenance (a row already written after 0278); default NULL. */
  source?: 'voice' | 'manual';
}

interface CaseExpect {
  voice: string | null;
  status: string | null;
  source: string | null;
}

const LATE_SHORT: VoiceSeed = {
  joinOffsetMin: 6,
  totalSec: 300,
  classification: 'no_show',
};

/** AC-2 rows (i)–(viii) plus two edges: unmarked signup, orphan voice row. */
const CASES: Record<string, { seed: CaseSeed; expect: CaseExpect }> = {
  i_lateShortCron: {
    seed: { status: 'no_show', voice: LATE_SHORT, matchBy: 'discord' },
    expect: { voice: 'late', status: 'attended', source: 'voice' },
  },
  ii_lateShortHandExcused: {
    seed: { status: 'excused', voice: LATE_SHORT, matchBy: 'discord' },
    expect: { voice: 'late', status: 'excused', source: 'manual' },
  },
  iii_onTimeShort: {
    seed: {
      status: 'no_show',
      voice: { joinOffsetMin: 5, totalSec: 300, classification: 'no_show' },
      matchBy: 'discord',
    },
    expect: { voice: 'no_show', status: 'no_show', source: 'voice' },
  },
  iv_synthetic0s: {
    seed: {
      status: 'no_show',
      voice: { joinOffsetMin: 10, totalSec: 0, classification: 'no_show' },
      matchBy: 'discord',
    },
    expect: { voice: 'no_show', status: 'no_show', source: 'voice' },
  },
  v_late119s: {
    seed: {
      status: 'no_show',
      voice: { joinOffsetMin: 6, totalSec: 119, classification: 'no_show' },
      matchBy: 'discord',
    },
    expect: { voice: 'no_show', status: 'no_show', source: 'voice' },
  },
  vi_full: {
    seed: {
      status: 'attended',
      voice: { joinOffsetMin: 0, totalSec: 3600, classification: 'full' },
      matchBy: 'discord',
    },
    expect: { voice: 'full', status: 'attended', source: 'voice' },
  },
  vii_userIdOnly: {
    seed: { status: 'no_show', voice: LATE_SHORT, matchBy: 'user' },
    expect: { voice: 'late', status: 'attended', source: 'voice' },
  },
  viii_noVoiceRow: {
    seed: { status: 'attended', voice: null, matchBy: 'discord' },
    expect: { voice: null, status: 'attended', source: 'manual' },
  },
  unmarkedSignup: {
    seed: { status: null, voice: null, matchBy: 'discord' },
    expect: { voice: null, status: null, source: null },
  },
  orphanVoiceRow: {
    seed: {
      status: null,
      voice: LATE_SHORT,
      matchBy: 'discord',
      hasSignup: false,
    },
    expect: { voice: 'late', status: null, source: null },
  },
};

interface SeededCase {
  userId: number;
  signupId: number | null;
  voiceId: string | null;
}

async function seedEvent(): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'ROK-1940 backfill event',
        creatorId: testApp.seed.adminUser.id,
        duration: [START, END],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return event.id;
}

async function seedUser(key: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `bf-${key}`, username: `bf_${key}` })
      .returning({ id: schema.users.id }),
    `user ${key}`,
  );
  return user.id;
}

async function seedSignup(
  eventId: number,
  userId: number,
  key: string,
  seed: CaseSeed,
): Promise<number> {
  const [signup] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId,
        discordUserId: seed.matchBy === 'discord' ? `bf-${key}` : null,
        attendanceStatus: seed.status,
        attendanceRecordedAt: seed.status ? END : null,
        attendanceSource: seed.source ?? null,
      })
      .returning({ id: schema.eventSignups.id }),
    `signup ${key}`,
  );
  return signup.id;
}

async function seedVoice(
  eventId: number,
  userId: number,
  key: string,
  voice: VoiceSeed,
): Promise<string> {
  const joinAt = new Date(START.getTime() + voice.joinOffsetMin * MIN);
  const leaveAt = new Date(joinAt.getTime() + voice.totalSec * 1000);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventVoiceSessions)
      .values({
        eventId,
        userId,
        discordUserId: `bf-${key}`,
        discordUsername: `bf_${key}`,
        firstJoinAt: joinAt,
        lastLeaveAt: leaveAt,
        totalDurationSec: voice.totalSec,
        classification: voice.classification,
      })
      .returning({ id: schema.eventVoiceSessions.id }),
    `voice ${key}`,
  );
  return row.id;
}

async function seedAll(): Promise<Map<string, SeededCase>> {
  const eventId = await seedEvent();
  const seeded = new Map<string, SeededCase>();
  for (const [key, { seed }] of Object.entries(CASES)) {
    const userId = await seedUser(key);
    const signupId =
      seed.hasSignup === false
        ? null
        : await seedSignup(eventId, userId, key, seed);
    const voiceId = seed.voice
      ? await seedVoice(eventId, userId, key, seed.voice)
      : null;
    seeded.set(key, { userId, signupId, voiceId });
  }
  return seeded;
}

async function readCase(c: SeededCase): Promise<CaseExpect> {
  const [signup] = c.signupId
    ? await testApp.db
        .select({
          status: schema.eventSignups.attendanceStatus,
          source: schema.eventSignups.attendanceSource,
        })
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.id, c.signupId))
    : [];
  const [voice] = c.voiceId
    ? await testApp.db
        .select({ classification: schema.eventVoiceSessions.classification })
        .from(schema.eventVoiceSessions)
        .where(eq(schema.eventVoiceSessions.id, c.voiceId))
    : [];
  return {
    voice: voice?.classification ?? null,
    status: signup?.status ?? null,
    source: signup?.source ?? null,
  };
}

function seededCase(seeded: Map<string, SeededCase>, key: string): SeededCase {
  const c = seeded.get(key);
  if (!c) throw new Error(`case ${key} was not seeded`);
  return c;
}

async function snapshotAll(): Promise<unknown[]> {
  const signups = await testApp.db
    .select({
      id: schema.eventSignups.id,
      status: schema.eventSignups.attendanceStatus,
      source: schema.eventSignups.attendanceSource,
      recordedAt: schema.eventSignups.attendanceRecordedAt,
    })
    .from(schema.eventSignups)
    .orderBy(asc(schema.eventSignups.id));
  const voice = await testApp.db
    .select({
      id: schema.eventVoiceSessions.id,
      classification: schema.eventVoiceSessions.classification,
    })
    .from(schema.eventVoiceSessions)
    .orderBy(asc(schema.eventVoiceSessions.id));
  return [signups, voice];
}

describe('migration 0279 voice-derived late backfill (ROK-1940 AC-2)', () => {
  it.each(Object.keys(CASES))('case %s ends as expected', async (key) => {
    const seeded = await seedAll();
    await runBackfill();
    const want = CASES[key]?.expect;
    expect(await readCase(seededCase(seeded, key))).toEqual(want);
  });

  it('leaves attendance_recorded_at untouched on a flipped signup', async () => {
    const seeded = await seedAll();
    await runBackfill();
    const { signupId } = seededCase(seeded, 'i_lateShortCron');
    if (signupId === null) throw new Error('case i has no signup');
    const [row] = await testApp.db
      .select({ recordedAt: schema.eventSignups.attendanceRecordedAt })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signupId));
    expect(row?.recordedAt?.getTime()).toBe(END.getTime());
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seedAll();
    await runBackfill();
    const afterFirst = await snapshotAll();
    await runBackfill();
    expect(await snapshotAll()).toEqual(afterFirst);
  });
});

describe('migration 0279 feeds the ROK-1938 leaderboard (ROK-1940 AC-3)', () => {
  it('counts a reclassified signup as attended AND late', async () => {
    const seeded = await seedAll();
    await runBackfill();
    const ids = ['i_lateShortCron', 'vii_userIdOnly', 'ii_lateShortHandExcused']
      .map((k) => seededCase(seeded, k).userId)
      .map(String);
    const { rows } = await queryUserReliability(testApp.db, 100, 0);
    const pick = (userId: string) => {
      const r = rows.find((row) => String(row.user_id) === userId);
      return r && { attended: Number(r.attended), late: Number(r.late) };
    };
    expect(ids.map(pick)).toEqual([
      { attended: 1, late: 1 },
      { attended: 1, late: 1 },
      { attended: 0, late: 0 },
    ]);
  });

  it('reported neither before the migration ran', async () => {
    const seeded = await seedAll();
    const userId = String(seededCase(seeded, 'i_lateShortCron').userId);
    const { rows } = await queryUserReliability(testApp.db, 100, 0);
    const r = rows.find((row) => String(row.user_id) === userId);
    expect(r && { attended: Number(r.attended), late: Number(r.late) }).toEqual(
      { attended: 0, late: 0 },
    );
  });
});

/** Sanity: the seed really is old-shape (no provenance on any row). */
describe('backfill seed shape (ROK-1940)', () => {
  it('seeds every signup with attendance_source NULL', async () => {
    const seeded = await seedAll();
    const signupIds = [...seeded.values()]
      .map((c) => c.signupId)
      .filter((id): id is number => id !== null);
    const rows = await testApp.db
      .select({ source: schema.eventSignups.attendanceSource })
      .from(schema.eventSignups)
      .where(inArray(schema.eventSignups.id, signupIds));
    expect(rows.map((r) => r.source)).toEqual(signupIds.map(() => null));
  });
});

/**
 * D5 S3 only flips signups whose provenance is 'voice'. A row an organiser
 * marked AFTER 0278 already carries 'manual' (S1 skips it — it is not NULL);
 * S2 still relabels its voice row, but the organiser's no_show must stand.
 */
describe('migration 0279 never overrides a manual mark (ROK-1940 AC-2)', () => {
  it('keeps a manual no_show with a late-short voice row as no_show', async () => {
    const eventId = await seedEvent();
    const userId = await seedUser('manualNoShow');
    const seed: CaseSeed = {
      status: 'no_show',
      voice: LATE_SHORT,
      matchBy: 'discord',
      source: 'manual',
    };
    const signupId = await seedSignup(eventId, userId, 'manualNoShow', seed);
    const voiceId = await seedVoice(
      eventId,
      userId,
      'manualNoShow',
      LATE_SHORT,
    );
    await runBackfill();
    expect(await readCase({ userId, signupId, voiceId })).toEqual({
      voice: 'late',
      status: 'no_show',
      source: 'manual',
    });
  });
});

/**
 * AC-5 (Q3 ruling): no game-roles code change — `voiceBranch` already keeps
 * any classification other than 'no_show', so a reclassified short late
 * joiner now counts as having "played" the event's game.
 */
describe('migration 0279 feeds Discord game roles (ROK-1940 AC-5)', () => {
  async function desiredUserIds(): Promise<number[]> {
    const gameId = testApp.seed.game.id;
    const members = await findDesiredMembers(
      testApp.db,
      gameId,
      30,
      new Date(),
    );
    return [...members.keys()];
  }

  it('counts a short late joiner as played only after the backfill', async () => {
    const seeded = await seedAll();
    await testApp.db
      .update(schema.events)
      .set({ gameId: testApp.seed.game.id });
    const lateUser = seededCase(seeded, 'i_lateShortCron').userId;
    const onTimeShort = seededCase(seeded, 'iii_onTimeShort').userId;

    expect(await desiredUserIds()).not.toContain(lateUser);
    await runBackfill();
    const after = await desiredUserIds();
    expect(after).toContain(lateUser);
    expect(after).not.toContain(onTimeShort);
  });
});
