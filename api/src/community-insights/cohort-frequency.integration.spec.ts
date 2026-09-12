/**
 * `GET /insights/community/cohort-game-frequency` integration tests
 * (ROK-1310, real DB).
 *
 * Route note: the ticket writes the path as `/community-insights/...`; the
 * real controller prefix is `insights/community`.
 *
 * The five AC scenarios:
 *   1. Sizes 2, 3 and 7 land in buckets `2`, `3` and `6+` with correct counts.
 *   2. The per-resolution breakdown splits decided/match/veto_won for a game.
 *   3. `mode=matched` excludes `veto_lost` rows entirely.
 *   4. `mode=rejected` returns only `veto_lost` rows, ranked by reject count.
 *   5. An empty table answers 200 with an empty payload — NOT the
 *      `503 no_snapshot_yet` every snapshot-backed insights endpoint returns.
 */
import type {
  CohortFrequencyBucketDto,
  CohortGameFrequencyResponseDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import {
  seedCohortMemoryRows,
  seedFrequencyGames,
  seedFrequencyLineup,
} from './__fixtures__/cohort-frequency-fixture';

const ROUTE = '/insights/community/cohort-game-frequency';

describe('Cohort game frequency (ROK-1310)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let adminId: number;
  let gameIds: number[];
  let lineupA: number;
  let lineupB: number;

  const fetchFrequency = async (
    query = '',
  ): Promise<CohortGameFrequencyResponseDto> => {
    const res = await testApp.request
      .get(`${ROUTE}${query}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body as CohortGameFrequencyResponseDto;
  };

  const bucket = (
    body: CohortGameFrequencyResponseDto,
    name: string,
  ): CohortFrequencyBucketDto | undefined =>
    body.buckets.find((b) => b.bucket === name);

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    const seed = await truncateAllTables(testApp.db);
    adminId = seed.adminUser.id;
    adminToken = await loginAsAdmin(testApp.request, seed);
    gameIds = await seedFrequencyGames(testApp.db, 3);
    lineupA = await seedFrequencyLineup(testApp.db, adminId, 'freq-a');
    lineupB = await seedFrequencyLineup(testApp.db, adminId, 'freq-b');
  });

  it('buckets cohort sizes 2, 3 and 7 into 2, 3 and 6+', async () => {
    await seedCohortMemoryRows(testApp.db, [
      { size: 2, gameId: gameIds[0], lineupId: lineupA, resolution: 'decided', cohort: 'x' },
      { size: 2, gameId: gameIds[0], lineupId: lineupB, resolution: 'decided', cohort: 'x' },
      { size: 3, gameId: gameIds[1], lineupId: lineupA, resolution: 'match', cohort: 'y' },
      { size: 7, gameId: gameIds[2], lineupId: lineupA, resolution: 'decided', cohort: 'z' },
    ]);

    const body = await fetchFrequency();

    expect(body.mode).toBe('matched');
    expect(body.buckets.map((b) => b.bucket)).toEqual(['2', '3', '6+']);
    expect(bucket(body, '2')!.entries[0]).toMatchObject({
      rank: 1,
      gameId: gameIds[0],
      count: 2,
    });
    expect(bucket(body, '3')!.entries[0].count).toBe(1);
    expect(bucket(body, '6+')!.entries[0]).toMatchObject({
      gameId: gameIds[2],
      count: 1,
    });
  });

  it('splits the per-resolution breakdown for one game', async () => {
    await seedCohortMemoryRows(testApp.db, [
      { size: 4, gameId: gameIds[0], lineupId: lineupA, resolution: 'decided', cohort: 'x' },
      { size: 4, gameId: gameIds[0], lineupId: lineupA, resolution: 'match', cohort: 'x' },
      { size: 4, gameId: gameIds[0], lineupId: lineupB, resolution: 'match', cohort: 'x' },
      { size: 4, gameId: gameIds[0], lineupId: lineupA, resolution: 'veto_won', cohort: 'x' },
    ]);

    const entry = (await fetchFrequency()).buckets[0].entries[0];

    expect(entry.count).toBe(4);
    expect(entry.breakdown).toEqual({
      decided: 1,
      match: 2,
      vetoWon: 1,
      vetoLost: 0,
    });
  });

  it('excludes veto_lost rows from mode=matched entirely', async () => {
    await seedCohortMemoryRows(testApp.db, [
      { size: 2, gameId: gameIds[0], lineupId: lineupA, resolution: 'decided', cohort: 'x' },
      { size: 2, gameId: gameIds[1], lineupId: lineupA, resolution: 'veto_lost', cohort: 'x' },
      { size: 2, gameId: gameIds[1], lineupId: lineupB, resolution: 'veto_lost', cohort: 'x' },
    ]);

    const body = await fetchFrequency('?mode=matched');

    const ids = body.buckets.flatMap((b) => b.entries.map((e) => e.gameId));
    expect(ids).toEqual([gameIds[0]]);
    expect(
      body.buckets.flatMap((b) => b.entries.map((e) => e.breakdown.vetoLost)),
    ).toEqual([0]);
  });

  it('mode=rejected returns only veto_lost rows ranked by reject count', async () => {
    await seedCohortMemoryRows(testApp.db, [
      { size: 3, gameId: gameIds[0], lineupId: lineupA, resolution: 'decided', cohort: 'x' },
      { size: 3, gameId: gameIds[1], lineupId: lineupA, resolution: 'veto_lost', cohort: 'x' },
      { size: 3, gameId: gameIds[2], lineupId: lineupA, resolution: 'veto_lost', cohort: 'x' },
      { size: 3, gameId: gameIds[2], lineupId: lineupB, resolution: 'veto_lost', cohort: 'x' },
    ]);

    const body = await fetchFrequency('?mode=rejected');

    expect(body.mode).toBe('rejected');
    const entries = bucket(body, '3')!.entries;
    expect(entries.map((e) => e.gameId)).toEqual([gameIds[2], gameIds[1]]);
    expect(entries[0]).toMatchObject({ rank: 1, count: 2 });
    expect(entries[0].breakdown).toEqual({
      decided: 0,
      match: 0,
      vetoWon: 0,
      vetoLost: 2,
    });
  });

  it('answers 200 with an empty payload when the table is empty', async () => {
    const res = await testApp.request
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`);

    // Explicit: the snapshot-backed siblings would answer 503 no_snapshot_yet.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'matched', buckets: [] });
  });
});
