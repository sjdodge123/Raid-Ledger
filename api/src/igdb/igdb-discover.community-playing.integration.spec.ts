/**
 * "Your Community Has Been Playing" discover row — TDD integration tests (ROK-565).
 *
 * These tests MUST fail on main — the `community-has-been-playing` slug does
 * not exist in buildDiscoverCategories() and GameDiscoverRowSchema does not
 * expose a `metadata` field yet. Dev agents building the feature make them
 * pass in Phase B.
 *
 * Spec: planning-artifacts/specs/ROK-565.md
 * Plan: planning-artifacts/plan-ROK-565.md
 * Architect guidance: planning-artifacts/architect-ROK-565.md
 *   (Test sequencing — extras: long-event-vs-short-Discord tiebreaker, cache miss→hit shape.)
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

const COMMUNITY_PLAYING_SLUG = 'community-has-been-playing';

interface DiscoverRow {
  category: string;
  slug: string;
  games: Array<{ id: number; name: string }>;
  metadata?: Record<string, { playerCount: number; totalSeconds: number }>;
}

/** Fetch /games/discover and return the rows array. */
async function fetchDiscoverRows(testApp: TestApp): Promise<DiscoverRow[]> {
  const res = await testApp.request.get('/games/discover');
  expect(res.status).toBe(200);
  return (res.body as { rows: DiscoverRow[] }).rows;
}

/** Return the community-playing row or undefined if missing. */
function findCommunityPlayingRow(rows: DiscoverRow[]): DiscoverRow | undefined {
  return rows.find((r) => r.slug === COMMUNITY_PLAYING_SLUG);
}

/** ISO date (YYYY-MM-DD) `daysAgo` days before today, matching game_activity_rollups.periodStart. */
function dateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Build a [start,end] tuple for event duration (tsrange) representing a past event. */
function pastEventRange(hoursEndAgo: number, hoursLong: number): [Date, Date] {
  const end = new Date(Date.now() - hoursEndAgo * 3_600_000);
  const start = new Date(end.getTime() - hoursLong * 3_600_000);
  return [start, end];
}

/** Build a [start,end] tuple for a future event. */
function futureEventRange(
  hoursFromNow: number,
  hoursLong: number,
): [Date, Date] {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  const end = new Date(start.getTime() + hoursLong * 3_600_000);
  return [start, end];
}

// ── seed helpers ─────────────────────────────────────────────

async function seedUser(
  testApp: TestApp,
  discordId: string,
  username: string,
): Promise<number> {
  const [u] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username, role: 'member' })
    .returning();
  return u.id;
}

async function seedGame(testApp: TestApp, name: string): Promise<number> {
  const [g] = await testApp.db
    .insert(schema.games)
    .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
    .returning();
  return g.id;
}

async function seedDiscordRollup(
  testApp: TestApp,
  userId: number,
  gameId: number,
  totalSeconds: number,
  daysAgo = 2,
): Promise<void> {
  await testApp.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'day',
    periodStart: dateDaysAgo(daysAgo),
    totalSeconds,
  });
}

async function seedSteamLibrary(
  testApp: TestApp,
  userId: number,
  gameId: number,
  playtime2weeks: number,
): Promise<void> {
  await testApp.db.insert(schema.gameInterests).values({
    userId,
    gameId,
    source: 'steam_library',
    playtime2weeks,
    playtimeForever: playtime2weeks * 5,
  });
}

interface AttendedEventOpts {
  duration?: [Date, Date];
  cancelled?: boolean;
  discordOnly?: boolean;
}

async function seedAttendedEvent(
  testApp: TestApp,
  creatorId: number,
  gameId: number | null,
  attendeeUserId: number | null,
  options: AttendedEventOpts = {},
): Promise<{ eventId: number; signupId: number }> {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Seeded Attended Event',
      creatorId,
      gameId,
      duration: options.duration ?? pastEventRange(24, 3),
      cancelledAt: options.cancelled ? new Date() : null,
    })
    .returning();
  const [signup] = await testApp.db
    .insert(schema.eventSignups)
    .values({
      eventId: event.id,
      userId: options.discordOnly ? null : attendeeUserId,
      discordUserId: options.discordOnly
        ? `discord-${event.id}-${Math.random().toString(36).slice(2, 8)}`
        : null,
      discordUsername: options.discordOnly ? 'Anon' : null,
      attendanceStatus: 'attended',
    })
    .returning();
  return { eventId: event.id, signupId: signup.id };
}

async function seedHideActivityPref(
  testApp: TestApp,
  userId: number,
): Promise<void> {
  await testApp.db.insert(schema.userPreferences).values({
    userId,
    key: 'show_activity',
    // jsonb boolean false — matches spec's `value = 'false'::jsonb` filter.
    value: false,
  });
}

// ── test suite ───────────────────────────────────────────────

describe('Community Has Been Playing discover row (ROK-565, integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    // Fresh cache between tests so cache hits from one test don't bleed into
    // assertions in the next (the truncate does not clear mock Redis on its
    // own for non-jwt-block keys).
    testApp.redisMock.store.clear();
  });

  it('appears first in /games/discover when any activity data exists (AC 1)', async () => {
    const userId = await seedUser(testApp, 'd:ac1', 'ac1-user');
    const gameId = await seedGame(testApp, 'AC1 Game');
    await seedDiscordRollup(testApp, userId, gameId, 3600);

    const rows = await fetchDiscoverRows(testApp);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].slug).toBe(COMMUNITY_PLAYING_SLUG);
    expect(rows[0].category).toBe('Your Community Has Been Playing');
  });

  it('unifies Discord rollups, Steam playtime2weeks, and attended events (AC 2)', async () => {
    const discordUser = await seedUser(testApp, 'd:src-disc', 'disc');
    const steamUser = await seedUser(testApp, 'd:src-steam', 'steam');
    const eventUser = await seedUser(testApp, 'd:src-event', 'evt');
    const gameId = await seedGame(testApp, 'Unified Game');

    await seedDiscordRollup(testApp, discordUser, gameId, 1800);
    await seedSteamLibrary(testApp, steamUser, gameId, 30); // 30 min → 1800s
    await seedAttendedEvent(testApp, eventUser, gameId, eventUser, {
      duration: pastEventRange(25, 1),
    });

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    expect(row!.games.map((g) => g.id)).toContain(gameId);
    const entry = row!.metadata?.[String(gameId)];
    expect(entry).toBeDefined();
    expect(entry!.playerCount).toBe(3);
  });

  it('ranks by unique player count desc, then total seconds desc (AC 3)', async () => {
    const uA = await seedUser(testApp, 'd:rankA', 'rA');
    const uB = await seedUser(testApp, 'd:rankB', 'rB');
    const uC = await seedUser(testApp, 'd:rankC', 'rC');
    const gameTop = await seedGame(testApp, 'Top Ranked');
    const gameMid = await seedGame(testApp, 'Mid Ranked');
    const gameTieBig = await seedGame(testApp, 'Tie Big Seconds');
    const gameTieSmall = await seedGame(testApp, 'Tie Small Seconds');

    // Top: 3 unique players
    await seedDiscordRollup(testApp, uA, gameTop, 100);
    await seedDiscordRollup(testApp, uB, gameTop, 100);
    await seedDiscordRollup(testApp, uC, gameTop, 100);
    // Mid: 2 unique players
    await seedDiscordRollup(testApp, uA, gameMid, 500);
    await seedDiscordRollup(testApp, uB, gameMid, 500);
    // Tie big / small: 1 unique player each, different seconds
    await seedDiscordRollup(testApp, uA, gameTieBig, 10_000);
    await seedDiscordRollup(testApp, uA, gameTieSmall, 100);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const orderedIds = row!.games.map((g) => g.id);
    expect(orderedIds.indexOf(gameTop)).toBe(0);
    expect(orderedIds.indexOf(gameMid)).toBe(1);
    expect(orderedIds.indexOf(gameTieBig)).toBeLessThan(
      orderedIds.indexOf(gameTieSmall),
    );
  });

  it('counts a user once but sums seconds when in all three sources for same game (AC 4)', async () => {
    const userId = await seedUser(testApp, 'd:multi', 'multi');
    const otherUser = await seedUser(testApp, 'd:multi-other', 'other');
    const gameId = await seedGame(testApp, 'Multi-source Game');

    // Same user in Discord (7200s) + Steam (60 min → 3600s) + event (1h → 3600s)
    await seedDiscordRollup(testApp, userId, gameId, 7200);
    await seedSteamLibrary(testApp, userId, gameId, 60);
    await seedAttendedEvent(testApp, otherUser, gameId, userId, {
      duration: pastEventRange(25, 1),
    });

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const entry = row!.metadata?.[String(gameId)];
    expect(entry).toBeDefined();
    expect(entry!.playerCount).toBe(1);
    expect(entry!.totalSeconds).toBe(7200 + 3600 + 3600);
  });

  it('omits the row when no qualifying activity exists, and includes it when any does (AC 5)', async () => {
    // Phase 1 — no rollups / interests / attended events → row absent.
    await seedGame(testApp, 'Lonely Game');
    const rowsEmpty = await fetchDiscoverRows(testApp);
    expect(findCommunityPlayingRow(rowsEmpty)).toBeUndefined();

    // Phase 2 — after adding a rollup, the row MUST appear. This half of the
    // test fails on main (no community-has-been-playing slug is registered),
    // proving the test actually exercises the feature and is not trivially
    // passing on the absence side.
    const userId = await seedUser(testApp, 'd:ac5', 'ac5');
    const gameId = await seedGame(testApp, 'AC5 Active Game');
    await seedDiscordRollup(testApp, userId, gameId, 900);

    const rowAfter = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(rowAfter).toBeDefined();
    expect(rowAfter!.games.map((g) => g.id)).toContain(gameId);
  });

  it('excludes users with show_activity=false; missing pref row = included (AC 6)', async () => {
    const hiddenUser = await seedUser(testApp, 'd:hidden', 'hid');
    const visibleUser = await seedUser(testApp, 'd:visible', 'vis');
    const creatorUser = await seedUser(testApp, 'd:creator6', 'crt6');
    const gameId = await seedGame(testApp, 'Privacy Game');
    await seedHideActivityPref(testApp, hiddenUser);

    // Hidden user contributes to all three sources for the same game
    await seedDiscordRollup(testApp, hiddenUser, gameId, 9000);
    await seedSteamLibrary(testApp, hiddenUser, gameId, 120);
    await seedAttendedEvent(testApp, creatorUser, gameId, hiddenUser, {
      duration: pastEventRange(25, 2),
    });
    // Visible user (no preference row) contributes only Discord
    await seedDiscordRollup(testApp, visibleUser, gameId, 1800);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const entry = row!.metadata?.[String(gameId)];
    expect(entry).toBeDefined();
    expect(entry!.playerCount).toBe(1);
    expect(entry!.totalSeconds).toBe(1800);
  });

  it('excludes attended events whose game_id IS NULL (AC 7)', async () => {
    const userId = await seedUser(testApp, 'd:nullgame', 'ng');
    const creatorUser = await seedUser(testApp, 'd:creator7', 'crt7');
    const validGame = await seedGame(testApp, 'AC7 Valid Game');

    // Event with null gameId — attendance should contribute to nothing.
    await seedAttendedEvent(testApp, creatorUser, null, userId, {
      duration: pastEventRange(25, 3),
    });
    // Separate valid signal so the row must exist. The null-game signup must
    // not appear in metadata and must not add users to any game's playerCount.
    await seedDiscordRollup(testApp, userId, validGame, 600);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const validEntry = row!.metadata?.[String(validGame)];
    expect(validEntry).toEqual({ playerCount: 1, totalSeconds: 600 });
    // Only one game (the valid one) should qualify — the null-game event
    // contributes no row.
    expect(row!.games.map((g) => g.id)).toEqual([validGame]);
  });

  it('excludes cancelled and future events (AC 8)', async () => {
    const userId = await seedUser(testApp, 'd:badevt', 'be');
    const creatorUser = await seedUser(testApp, 'd:creator8', 'crt8');
    const cancelledGame = await seedGame(testApp, 'Cancelled Event Game');
    const futureGame = await seedGame(testApp, 'Future Event Game');
    const validGame = await seedGame(testApp, 'AC8 Valid Game');

    // Cancelled past event
    await seedAttendedEvent(testApp, creatorUser, cancelledGame, userId, {
      duration: pastEventRange(25, 2),
      cancelled: true,
    });
    // Future event — ends after NOW()
    await seedAttendedEvent(testApp, creatorUser, futureGame, userId, {
      duration: futureEventRange(2, 3),
    });
    // Separate valid signal so the row must exist.
    await seedDiscordRollup(testApp, userId, validGame, 900);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const ids = row!.games.map((g) => g.id);
    expect(ids).toContain(validGame);
    expect(ids).not.toContain(cancelledGame);
    expect(ids).not.toContain(futureGame);
  });

  it('excludes anonymous Discord signups (user_id IS NULL) (AC 9)', async () => {
    const creatorUser = await seedUser(testApp, 'd:creator9', 'crt9');
    const anonGame = await seedGame(testApp, 'Anonymous Signup Game');
    const validGame = await seedGame(testApp, 'AC9 Valid Game');
    const validUser = await seedUser(testApp, 'd:ac9-valid', 'ac9v');

    // Anonymous discord signup — must be excluded.
    await seedAttendedEvent(testApp, creatorUser, anonGame, null, {
      duration: pastEventRange(25, 3),
      discordOnly: true,
    });
    // Separate valid signal so the row exists. The anonymous signup must not
    // appear in metadata and must not add a ghost user to anonGame.
    await seedDiscordRollup(testApp, validUser, validGame, 1200);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const ids = row!.games.map((g) => g.id);
    expect(ids).toContain(validGame);
    expect(ids).not.toContain(anonGame);
    expect(row!.metadata?.[String(anonGame)]).toBeUndefined();
  });

  it('exposes metadata keyed by stringified gameId with correct aggregates (AC 10)', async () => {
    const uA = await seedUser(testApp, 'd:mdA', 'mdA');
    const uB = await seedUser(testApp, 'd:mdB', 'mdB');
    const gX = await seedGame(testApp, 'Metadata X');
    const gY = await seedGame(testApp, 'Metadata Y');

    await seedDiscordRollup(testApp, uA, gX, 3600);
    await seedDiscordRollup(testApp, uB, gX, 1800);
    await seedDiscordRollup(testApp, uA, gY, 600);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    expect(row!.metadata).toBeDefined();
    expect(row!.metadata![String(gX)]).toEqual({
      playerCount: 2,
      totalSeconds: 5400,
    });
    expect(row!.metadata![String(gY)]).toEqual({
      playerCount: 1,
      totalSeconds: 600,
    });
  });

  it('caps the row at 20 games even when more qualifying games exist (AC 11)', async () => {
    const userId = await seedUser(testApp, 'd:cap', 'cap');
    // Seed 25 games each with one Discord rollup for the same user.
    for (let i = 0; i < 25; i++) {
      const gId = await seedGame(testApp, `Cap Game ${i}`);
      await seedDiscordRollup(testApp, userId, gId, 100 + i);
    }

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    expect(row!.games.length).toBe(20);
  });

  it('breaks ties by total_seconds so a long event outranks a short Discord session (architect extra 1)', async () => {
    const longEventUser = await seedUser(testApp, 'd:longevt', 'le');
    const creatorUser = await seedUser(testApp, 'd:creator12', 'crt12');
    const shortDiscUser = await seedUser(testApp, 'd:shortdisc', 'sd');

    const longGame = await seedGame(testApp, 'Long Event Game');
    const shortGame = await seedGame(testApp, 'Short Discord Game');

    // 6-hour attended event → 21600s for one user.
    await seedAttendedEvent(testApp, creatorUser, longGame, longEventUser, {
      duration: pastEventRange(25, 6),
    });
    // 30 minutes of Discord playtime → 1800s for a different user.
    await seedDiscordRollup(testApp, shortDiscUser, shortGame, 1800);

    const row = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(row).toBeDefined();
    const ids = row!.games.map((g) => g.id);
    // Both games have playerCount=1 — long event wins on secondary sort.
    expect(ids.indexOf(longGame)).toBeLessThan(ids.indexOf(shortGame));
    expect(row!.metadata![String(longGame)].playerCount).toBe(1);
    expect(row!.metadata![String(shortGame)].playerCount).toBe(1);
    expect(row!.metadata![String(longGame)].totalSeconds).toBeGreaterThan(
      row!.metadata![String(shortGame)].totalSeconds,
    );
  });

  it('preserves { games, metadata } shape across a cache miss → cache hit cycle (architect extra 2)', async () => {
    const userId = await seedUser(testApp, 'd:cache', 'ch');
    const otherUser = await seedUser(testApp, 'd:cache-other', 'co');
    const gameId = await seedGame(testApp, 'Cache Game');
    await seedDiscordRollup(testApp, userId, gameId, 4200);
    await seedDiscordRollup(testApp, otherUser, gameId, 1200);

    // Ensure the very first call is a true cache miss.
    testApp.redisMock.store.clear();
    const firstRow = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(firstRow).toBeDefined();
    expect(firstRow!.metadata).toBeDefined();
    expect(firstRow!.metadata![String(gameId)]).toEqual({
      playerCount: 2,
      totalSeconds: 5400,
    });

    // Second call must hit the cache — and must return an identical shape,
    // including metadata. Regressions where the cache payload drops metadata
    // (architect §3 cache-shape divergence) are caught here.
    const secondRow = findCommunityPlayingRow(await fetchDiscoverRows(testApp));
    expect(secondRow).toBeDefined();
    expect(secondRow!.games.map((g) => g.id)).toEqual(
      firstRow!.games.map((g) => g.id),
    );
    expect(secondRow!.metadata).toEqual(firstRow!.metadata);
    expect(secondRow!.metadata![String(gameId)]).toEqual({
      playerCount: 2,
      totalSeconds: 5400,
    });
  });
});
