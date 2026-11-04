/**
 * POST /games/similar after the ROK-1939 D9 pvp narrowing (Codex P2s).
 *
 * - A game whose 7-dim core vector is all-zero must never come back with
 *   `similarity: null` (pgvector cosine distance is NaN for a zero norm),
 *   and a zero-norm anchor has nothing to rank.
 * - A zero-norm candidate stays in the results at similarity 0, ranked after
 *   every positive-norm candidate (dropping it starved `multiplayerOnly`).
 * - `multiplayerOnly` must keep an FPS/Shooter/Multiplayer game — it no
 *   longer scores on any group-play axis — and still drop a solo game.
 * - Each multiplayer signal ALONE keeps a game eligible.
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

type SeedOpts = {
  tags?: string[];
  genres?: number[];
  gameModes?: number[];
  playerCount?: { min: number; max: number };
  cooptimusOnlineMax?: number;
};

const SOLO: SeedOpts = {
  tags: ['Singleplayer'],
  gameModes: [1],
  playerCount: { min: 1, max: 1 },
  cooptimusOnlineMax: 1,
};

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

  async function seedGame(name: string, opts: SeedOpts): Promise<number> {
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
          ...(opts.playerCount ? { playerCount: opts.playerCount } : {}),
          ...(opts.cooptimusOnlineMax !== undefined
            ? { cooptimusOnlineMax: opts.cooptimusOnlineMax }
            : {}),
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

  /**
   * Pin a candidate's vector row: non-zero core vector, confident, and only
   * the given group-play dimensions — so metadata alone decides eligibility.
   */
  async function pinVector(
    gameId: number,
    dimensions: Record<string, number>,
  ): Promise<void> {
    await testApp.db.execute(sql`
      INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
      VALUES (${gameId}, '[1,1,1,1,1,1,1]'::vector,
              ${JSON.stringify(dimensions)}::jsonb, 0.5, 'pinned')
      ON CONFLICT (game_id) DO UPDATE
      SET vector = EXCLUDED.vector, dimensions = EXCLUDED.dimensions,
          confidence = EXCLUDED.confidence
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

  it('keeps a zero-norm candidate at similarity 0, ranked after positive-norm ones', async () => {
    const anchor = await seedGame('ZN Anchor RPG', { genres: [12] });
    const peer = await seedGame('ZN Peer RPG', { genres: [12] });
    const zero = await seedGame('ZN Zero Shooter', { tags: ['FPS'] });
    await runAggregateGameVectors(testApp.db);
    await forceZeroNorm(zero);

    const rows = await similar({ gameId: anchor, limit: 10 });

    const ids = rows.map((r) => r.gameId);
    expect(ids).toContain(peer);
    expect(ids).toContain(zero);
    expect(ids.indexOf(zero)).toBeGreaterThan(ids.indexOf(peer));
    expect(rows.find((r) => r.gameId === zero)?.similarity).toBe(0);
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

  it.each<[string, SeedOpts, Record<string, number>]>([
    ['a group-play taste axis', {}, { moba: 0.5 }],
    ['IGDB mode 2 (Multiplayer)', { gameModes: [2] }, {}],
    ['IGDB mode 3 (Co-operative)', { gameModes: [3] }, {}],
    ['IGDB mode 4 (Split screen)', { gameModes: [4] }, {}],
    ['IGDB mode 5 (MMO)', { gameModes: [5] }, {}],
    ['IGDB mode 6 (Battle Royale)', { gameModes: [6] }, {}],
    ['an upper-case MULTIPLAYER tag', { tags: ['MULTIPLAYER'] }, {}],
    ['an Online PvP tag (shared wildcard list)', { tags: ['Online PvP'] }, {}],
    ['player_count.max > 1', { playerCount: { min: 1, max: 4 } }, {}],
    ['Co-Optimus online max > 1', { cooptimusOnlineMax: 4 }, {}],
  ])(
    'multiplayerOnly keeps a game whose only multiplayer signal is %s',
    async (_label, opts, dims) => {
      const anchor = await seedGame('Sig Anchor', { tags: ['Co-op'] });
      const candidate = await seedGame('Sig Candidate', opts);
      const solo = await seedGame('Sig Solo', SOLO);
      await runAggregateGameVectors(testApp.db);
      await pinVector(candidate, dims);
      await pinVector(solo, {});

      const rows = await similar({
        gameId: anchor,
        limit: 50,
        multiplayerOnly: true,
      });

      const ids = rows.map((r) => r.gameId);
      expect(ids).toContain(candidate);
      expect(ids).not.toContain(solo);
    },
  );
});
