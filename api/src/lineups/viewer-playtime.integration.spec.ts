/**
 * ROK-1375 — per-viewer "You own this · Nh played" on lineup nominations.
 *
 * `currentUserPlaytimeMinutes` rides the SAME batched viewer query as the
 * ROK-1314 `currentUserOwns` flag (`loadViewerInterests`), read from the
 * viewer's `game_interests` row with `source='steam_library'`:
 *   • owned with synced playtime → owns true + the minutes
 *   • owned, no synced playtime  → owns true + null
 *   • not owned by the viewer    → owns false + null (another user's row
 *                                  never leaks)
 *   • no viewer                  → the playtime field is ABSENT
 *
 * GET /lineups/:id sits behind the JWT guard, so the anonymous case calls
 * `buildDetailResponse` directly with no viewer id against the real DB.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { buildDetailResponse } from './lineups-response.helpers';

interface PlaytimeEntry {
  gameId: number;
  ownerCount: number;
  currentUserOwns?: boolean;
  currentUserPlaytimeMinutes?: number | null;
}

function describeViewerPlaytime() {
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

  async function createLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'ROK-1375 Viewer Playtime' });
    if (res.status !== 201) {
      throw new Error(
        `createLineup: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  async function insertGame(name: string): Promise<number> {
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name,
          slug: `rok1375-${Date.now()}-${Math.random()}`,
          steamAppId: Math.floor(Math.random() * 900000) + 100000,
        })
        .returning(),
      'inserted game',
    );
    return game.id;
  }

  async function insertUser(handle: string): Promise<number> {
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:${handle}`,
          username: handle,
          role: 'member',
        })
        .returning(),
      'inserted user',
    );
    return user.id;
  }

  async function own(
    userId: number,
    gameId: number,
    playtimeForever: number | null,
  ): Promise<void> {
    await testApp.db.insert(schema.gameInterests).values({
      userId,
      gameId,
      source: 'steam_library',
      playtimeForever,
    });
  }

  async function nominate(lineupId: number, gameId: number): Promise<void> {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId,
      nominatedBy: testApp.seed.adminUser.id,
    });
  }

  async function fetchEntries(lineupId: number): Promise<PlaytimeEntry[]> {
    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.entries as PlaytimeEntry[];
  }

  function entryFor(entries: PlaytimeEntry[], gameId: number): PlaytimeEntry {
    const entry = entries.find((e) => e.gameId === gameId);
    if (!entry) throw new Error(`no entry for game ${gameId}`);
    return entry;
  }

  it('returns owns + playtime for a game in the viewer steam library', async () => {
    const lineupId = await createLineup();
    const gameId = await insertGame('Owned With Playtime');
    await own(testApp.seed.adminUser.id, gameId, 720);
    await nominate(lineupId, gameId);

    const entry = entryFor(await fetchEntries(lineupId), gameId);

    expect(entry.currentUserOwns).toBe(true);
    expect(entry.currentUserPlaytimeMinutes).toBe(720);
  });

  it('returns owns true + null playtime when Steam synced no playtime', async () => {
    const lineupId = await createLineup();
    const gameId = await insertGame('Owned No Playtime');
    await own(testApp.seed.adminUser.id, gameId, null);
    await nominate(lineupId, gameId);

    const entry = entryFor(await fetchEntries(lineupId), gameId);

    expect(entry.currentUserOwns).toBe(true);
    expect(entry.currentUserPlaytimeMinutes).toBeNull();
  });

  it('returns owns false + null for a game only ANOTHER user owns (no leak)', async () => {
    const lineupId = await createLineup();
    const mine = await insertGame('Mine');
    const theirs = await insertGame('Theirs');
    const otherUser = await insertUser('rok1375-other');
    await own(testApp.seed.adminUser.id, mine, 60);
    await own(otherUser, theirs, 9000);
    await nominate(lineupId, mine);
    await nominate(lineupId, theirs);

    const entry = entryFor(await fetchEntries(lineupId), theirs);

    expect(entry.ownerCount).toBe(1);
    expect(entry.currentUserOwns).toBe(false);
    expect(entry.currentUserPlaytimeMinutes).toBeNull();
  });

  it('omits the playtime field entirely when there is no viewer', async () => {
    const lineupId = await createLineup();
    const gameId = await insertGame('Anonymous View');
    await own(testApp.seed.adminUser.id, gameId, 720);
    await nominate(lineupId, gameId);

    const detail = await buildDetailResponse(testApp.db, lineupId);
    const entry = detail.entries.find((e) => e.gameId === gameId);

    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('currentUserPlaytimeMinutes');
    expect(entry?.currentUserOwns).toBe(false);
  });
}

describe('ROK-1375 viewer playtime on lineup entries (integration)', () =>
  describeViewerPlaytime());
