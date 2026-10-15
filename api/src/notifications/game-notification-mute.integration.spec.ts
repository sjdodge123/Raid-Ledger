/**
 * ROK-1797 — a per-game notification mute drops the user from EVERY per-game
 * broadcast recipient read, on both affinity halves (heart / Steam row AND
 * past signup), without touching the heart; and games-dedup merges carry it.
 *
 * Fixture on game G (all non-creator users):
 *   A  admin, manual heart, MUTED on G
 *   B  steam_library row only, no suppression, MUTED on G
 *   C  past `signed_up` signup only, MUTED on G
 *   D  manual heart, not muted (control)
 *   E  manual heart on G, muted on a DIFFERENT game H
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { findGameAffinityRecipients } from './game-affinity-recipients.helpers';
import { findRecipients as findReminderRecipients } from './recruitment-reminder.helpers';
import { findStandalonePollRecipients } from '../lineups/standalone-poll/standalone-poll-recipients.helpers';
import { reassignMiscFks } from '../igdb/igdb-dedup-fk-reassign.helpers';

type Ids = Record<'A' | 'B' | 'C' | 'D' | 'E', number>;

const HOUR = 3_600_000;

function describeGameNotificationMute() {
  let testApp: TestApp;
  let token: string;
  let creatorId: number;
  let gameG: number;
  let gameH: number;
  let ids: Ids;

  const insertGame = async (slug: string): Promise<number> => {
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: `Mute ${slug}`, slug })
        .returning({ id: schema.games.id }),
      'game',
    );
    return g.id;
  };

  const insertUser = async (tag: string): Promise<number> => {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: `mute-${tag}`, username: `mute-${tag}` })
        .returning({ id: schema.users.id }),
      'user',
    );
    return u.id;
  };

  const seedPastSignup = async (userId: number): Promise<void> => {
    const start = new Date(Date.now() - 48 * HOUR);
    const duration: [Date, Date] = [start, new Date(start.getTime() + HOUR)];
    const [ev] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({ title: 'Past', creatorId, gameId: gameG, duration })
        .returning({ id: schema.events.id }),
      'event',
    );
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: ev.id, userId, status: 'signed_up' });
  };

  const mute = (userId: number, gameId: number) =>
    testApp.db.insert(schema.gameNotificationMutes).values({ userId, gameId });

  const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
  const expected = (): number[] => sorted([ids.D, ids.E]);

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    token = await loginAsAdmin(testApp.request, testApp.seed);
    gameG = await insertGame('mute-g');
    gameH = await insertGame('mute-h');
    creatorId = await insertUser('creator');
    ids = {
      A: testApp.seed.adminUser.id,
      B: await insertUser('b'),
      C: await insertUser('c'),
      D: await insertUser('d'),
      E: await insertUser('e'),
    };
    await testApp.db.insert(schema.gameInterests).values([
      { userId: ids.A, gameId: gameG, source: 'manual' },
      { userId: ids.B, gameId: gameG, source: 'steam_library' },
      { userId: ids.D, gameId: gameG, source: 'manual' },
      { userId: ids.E, gameId: gameG, source: 'manual' },
    ]);
    await seedPastSignup(ids.C);
    for (const u of [ids.A, ids.B, ids.C]) await mute(u, gameG);
    await mute(ids.E, gameH);
  });

  it('game-alert recipients drop muted users on both affinity halves', async () => {
    const got = await findGameAffinityRecipients(testApp.db, gameG, {
      excludeUserId: creatorId,
    });
    expect(sorted(got)).toEqual(expected());
  });

  it('LFG (interestsOnly) recipients drop muted users', async () => {
    const got = await findGameAffinityRecipients(testApp.db, gameG, {
      excludeUserId: creatorId,
      interestsOnly: true,
    });
    expect(sorted(got)).toEqual(expected());
  });

  it('recruitment-reminder recipients drop muted users', async () => {
    const got = await findReminderRecipients(testApp.db, gameG, creatorId, -1);
    expect(sorted(got)).toEqual(expected());
  });

  it('standalone-poll recipients drop muted users', async () => {
    const got = await findStandalonePollRecipients(
      testApp.db,
      gameG,
      creatorId,
    );
    expect(sorted(got)).toEqual(expected());
  });

  it('un-heart keeps the mute, and a re-hearted muted user stays excluded', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const del = await testApp.request
      .delete(`/games/${gameG}/want-to-play`)
      .set(auth);
    expect(del.status).toBe(200);
    const muteRows = await testApp.db
      .select()
      .from(schema.gameNotificationMutes)
      .where(
        and(
          eq(schema.gameNotificationMutes.userId, ids.A),
          eq(schema.gameNotificationMutes.gameId, gameG),
        ),
      );
    expect(muteRows).toHaveLength(1);
    const post = await testApp.request
      .post(`/games/${gameG}/want-to-play`)
      .set(auth);
    expect(post.status).toBe(200);
    const got = await findGameAffinityRecipients(testApp.db, gameG, {
      excludeUserId: creatorId,
    });
    expect(got).not.toContain(ids.A);
  });

  it('a games-dedup merge moves the loser mute and collapses a double mute', async () => {
    // Loser H: E (muted only on H) moves; A muted on BOTH collapses to one.
    await mute(ids.A, gameH);
    await testApp.db.transaction((tx) => reassignMiscFks(tx, gameH, gameG));
    const rows = await testApp.db
      .select({
        userId: schema.gameNotificationMutes.userId,
        gameId: schema.gameNotificationMutes.gameId,
      })
      .from(schema.gameNotificationMutes);
    const pairs = rows
      .map((r) => `${r.userId}:${r.gameId}`)
      .sort((a, b) => a.localeCompare(b));
    const want = [ids.A, ids.B, ids.C, ids.E]
      .map((u) => `${u}:${gameG}`)
      .sort((a, b) => a.localeCompare(b));
    expect(pairs).toEqual(want);
  });
}

describe('Per-game notification mute gate (ROK-1797)', () =>
  describeGameNotificationMute());
