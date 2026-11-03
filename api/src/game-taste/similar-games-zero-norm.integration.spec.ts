/**
 * POST /games/similar after the ROK-1939 D9 pvp narrowing (Codex P2s).
 *
 * - A game whose 7-dim core vector is all-zero must never come back with
 *   `similarity: null` (pgvector cosine distance is NaN for a zero norm),
 *   and a zero-norm anchor has nothing to rank.
 * - `multiplayerOnly` must keep an FPS/Shooter/Multiplayer game — it no
 *   longer scores on any group-play axis — and still drop a solo game.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import {
  runAggregateGameVectors,
  __resetBatchCacheForTests,
} from './pipelines/aggregate-game-vectors';

type SimilarRow = { gameId: number; similarity: unknown };

describe('POST /games/similar — ROK-1939 D9 regressions', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(() => {
    __resetBatchCacheForTests();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function seedGame(
    name: string,
    opts: { tags?: string[]; genres?: number[]; gameModes?: number[] },
  ): Promise<number> {
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name,
          slug: name.toLowerCase().replace(/\s+/g, '-'),
          genres: opts.genres ?? [],
          gameModes: opts.gameModes ?? [],
          themes: [],
          itadTags: opts.tags ?? [],
        })
        .returning(),
      'g',
    );
    return g.id;
  }

  /** Zero the core vector but keep confidence high, so only the norm guard can drop it. */
  async function forceZeroNorm(gameId: number): Promise<void> {
    await testApp.db.execute(sql`
      UPDATE game_taste_vectors
      SET vector = '[0,0,0,0,0,0,0]'::vector, confidence = 0.5
      WHERE game_id = ${gameId}
    `);
  }

  async function similar(body: object): Promise<SimilarRow[]> {
    const res = await testApp.request
      .post('/games/similar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(200);
    return (res.body as { similar: SimilarRow[] }).similar;
  }

  it('excludes a zero-norm candidate and returns only finite similarities', async () => {
    const anchor = await seedGame('ZN Anchor RPG', { genres: [12] });
    const peer = await seedGame('ZN Peer RPG', { genres: [12] });
    const zero = await seedGame('ZN Zero Shooter', { tags: ['FPS'] });
    await runAggregateGameVectors(testApp.db);
    await forceZeroNorm(zero);

    const rows = await similar({ gameId: anchor, limit: 10 });

    const ids = rows.map((r) => r.gameId);
    expect(ids).toContain(peer);
    expect(ids).not.toContain(zero);
    for (const r of rows) expect(Number.isFinite(r.similarity)).toBe(true);
  });

  it('returns [] for a zero-norm anchor game', async () => {
    const anchor = await seedGame('ZN Empty Anchor', { tags: ['FPS'] });
    await seedGame('ZN Other RPG', { genres: [12] });
    await runAggregateGameVectors(testApp.db);
    await forceZeroNorm(anchor);

    expect(await similar({ gameId: anchor, limit: 10 })).toEqual([]);
  });

  it('multiplayerOnly keeps an FPS/Shooter/Multiplayer game and drops a solo game', async () => {
    const coop = await seedGame('MP Coop Anchor', { tags: ['Co-op'] });
    const fps = await seedGame('MP Shooter', {
      tags: ['FPS', 'Shooter', 'Multiplayer'],
      gameModes: [1, 2],
    });
    const solo = await seedGame('MP Solo RPG', {
      tags: ['RPG', 'Singleplayer'],
      gameModes: [1],
    });
    await runAggregateGameVectors(testApp.db);
    // Precondition: the shooter scores on no group-play axis (D9), so only
    // the metadata-based eligibility can keep it.
    const [dims] = await testApp.db.execute<{ group_play: number }>(sql`
      SELECT (dimensions->>'pvp')::float + (dimensions->>'co_op')::float
           + (dimensions->>'mmo')::float + (dimensions->>'battle_royale')::float
           + (dimensions->>'moba')::float AS group_play
      FROM game_taste_vectors WHERE game_id = ${fps}
    `);
    expect(dims?.group_play).toBe(0);

    const rows = await similar({
      gameId: coop,
      limit: 10,
      multiplayerOnly: true,
    });

    const ids = rows.map((r) => r.gameId);
    expect(ids).toContain(fps);
    expect(ids).not.toContain(solo);
  });
});
