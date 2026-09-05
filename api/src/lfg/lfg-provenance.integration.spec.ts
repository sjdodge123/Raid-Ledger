/**
 * ROK-1454 AC-P — the PINNED test. Real Postgres, so the predicate is executed
 * by the database rather than asserted structurally.
 *
 * A converted group is historical on TWO axes: `convertGroup` flips every live
 * intent to `status = 'converted'` and never resets `expires_at`. Round 1 read
 * that group back through `liveIntent`, which filters on `status = 'active'`
 * AND `expires_at > now()`, so the roster came back empty and the terminal
 * embed silently lost everyone.
 *
 * Every fixture here is therefore non-active AND past-expiry — both axes at
 * once — and the first case carries a CONTROL assertion: `listGroupMembers`
 * (the live read, unchanged by this story) must return ZERO for the identical
 * fixture. Without that control the test could pass against a read that had
 * quietly kept working for the wrong reason.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import {
  DAY_MS,
  createGame,
  createLineupMatch,
  deactivateUser,
} from './lfg.integration.spec-helpers';
import { listGroupMembers } from './lfg-query.helpers';
import { listConvertedGroupMembers } from './lfg-provenance.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

interface ConvertedIntent {
  userId: number;
  gameId: number;
  /** Minutes of stagger on `created_at`, so roster order is deterministic. */
  joinedMinutesAgo: number;
  eventId?: number;
  pollId?: number;
}

/**
 * Seed one intent in exactly the state `convertGroup` leaves behind: status
 * `converted`, provenance FK set, and `expires_at` ALREADY IN THE PAST —
 * because conversion never resets the clock.
 */
async function seedConvertedIntent(i: ConvertedIntent): Promise<void> {
  await testApp.db.insert(schema.lfgIntents).values({
    userId: i.userId,
    gameId: i.gameId,
    status: 'converted',
    visibility: 'local',
    createdAt: new Date(Date.now() - i.joinedMinutesAgo * 60_000),
    expiresAt: new Date(Date.now() - 2 * DAY_MS),
    convertedToPollId: i.pollId ?? null,
    convertedToEventId: i.eventId ?? null,
  });
}

async function member(name: string): Promise<number> {
  const { userId } = await createMemberAndLogin(
    testApp,
    name,
    `${name}@test.local`,
  );
  return userId;
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-P — a converted, long-expired group still reads back its full membership
// ═══════════════════════════════════════════════════════════════════════════

describe('listConvertedGroupMembers — AC-P', () => {
  it('returns every member of a converted group whose intents are ALSO expired, oldest first — while the live read returns none', async () => {
    const game = await createGame(testApp, 'Deep Rock Galactic');
    const eventId = await createFutureEvent(testApp, adminToken);
    const bosco = await member('bosco');
    const karl = await member('karl');
    const doretta = await member('doretta');

    // Inserted out of order on purpose: ordering must come from `created_at`.
    await seedConvertedIntent({
      userId: doretta,
      gameId: game.id,
      joinedMinutesAgo: 10,
      eventId,
    });
    await seedConvertedIntent({
      userId: bosco,
      gameId: game.id,
      joinedMinutesAgo: 30,
      eventId,
    });
    await seedConvertedIntent({
      userId: karl,
      gameId: game.id,
      joinedMinutesAgo: 20,
      eventId,
    });

    const members = await listConvertedGroupMembers(testApp.db, game.id, {
      eventId,
    });

    expect(members.map((m) => m.username)).toEqual([
      'bosco',
      'karl',
      'doretta',
    ]);

    // CONTROL: the live read, unchanged by this story, sees nobody in the very
    // same fixture. This is what proves the two reads genuinely differ — and
    // that the live one is what round 1 got wrong.
    const live = await listGroupMembers(testApp.db, game.id);
    expect(live).toEqual([]);
  });
});

describe('listConvertedGroupMembers — scoping', () => {
  it('is target-scoped: a group converted into a DIFFERENT event never leaks in', async () => {
    const game = await createGame(testApp, 'Valheim');
    const thisMonth = await createFutureEvent(testApp, adminToken);
    const lastMonth = await createFutureEvent(testApp, adminToken);
    const inGroup = await member('haldor');
    const stranger = await member('hugin');

    await seedConvertedIntent({
      userId: inGroup,
      gameId: game.id,
      joinedMinutesAgo: 10,
      eventId: thisMonth,
    });
    await seedConvertedIntent({
      userId: stranger,
      gameId: game.id,
      joinedMinutesAgo: 40,
      eventId: lastMonth,
    });

    const members = await listConvertedGroupMembers(testApp.db, game.id, {
      eventId: thisMonth,
    });

    expect(members.map((m) => m.username)).toEqual(['haldor']);
  });

  it('excludes a deactivated holder, so a public channel message can never name them', async () => {
    const game = await createGame(testApp, 'Grounded');
    const eventId = await createFutureEvent(testApp, adminToken);
    const present = await member('max');
    const departed = await member('willow');

    await seedConvertedIntent({
      userId: present,
      gameId: game.id,
      joinedMinutesAgo: 10,
      eventId,
    });
    await seedConvertedIntent({
      userId: departed,
      gameId: game.id,
      joinedMinutesAgo: 20,
      eventId,
    });
    await deactivateUser(testApp, departed);

    const members = await listConvertedGroupMembers(testApp.db, game.id, {
      eventId,
    });

    expect(members.map((m) => m.username)).toEqual(['max']);
  });
});

describe('listConvertedGroupMembers — poll provenance', () => {
  it('filters on converted_to_poll_id for a poll target', async () => {
    const game = await createGame(testApp, 'Lethal Company');
    const eventId = await createFutureEvent(testApp, adminToken);
    const voter = await member('employee-a');
    const other = await member('employee-b');
    const matchId = await createLineupMatch(testApp, voter, game.id);

    await seedConvertedIntent({
      userId: voter,
      gameId: game.id,
      joinedMinutesAgo: 10,
      pollId: matchId,
    });
    // Same game, same window, converted into an EVENT instead — must not
    // appear in the poll-target read.
    await seedConvertedIntent({
      userId: other,
      gameId: game.id,
      joinedMinutesAgo: 20,
      eventId,
    });

    const members = await listConvertedGroupMembers(testApp.db, game.id, {
      pollId: matchId,
    });

    expect(members.map((m) => m.username)).toEqual(['employee-a']);
  });
});
