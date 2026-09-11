/**
 * Integration tests for `resolveCandidates` (ROK-567). Seeds a small set of
 * `games` + `game_taste_vectors` rows against a real Postgres instance and
 * asserts top-N ordering + genre post-filtering.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { resolveCandidates } from './candidate-resolver';

describe('resolveCandidates (ROK-567)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedGameWithVector(
    name: string,
    vector: number[],
    opts: {
      genres?: number[];
      confidence?: number;
      playerCount?: { min: number; max: number } | null;
    } = {},
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        genres: opts.genres ?? [],
        playerCount: opts.playerCount ?? null,
      })
      .returning();
    await testApp.db.execute(sql`
      INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
      VALUES (
        ${game.id},
        ${`[${vector.join(',')}]`}::vector,
        '{}'::jsonb,
        ${opts.confidence ?? 0.9},
        ${`hash-${game.id}`}
      )
    `);
    return game.id;
  }

  it('returns top-N game IDs by cosine similarity to the theme', async () => {
    const near = await seedGameWithVector('Near', [1, 0, 0, 0, 0, 0, 0]);
    const mid = await seedGameWithVector('Mid', [0.5, 0.5, 0, 0, 0, 0, 0]);
    const far = await seedGameWithVector('Far', [0, 0, 0, 0, 0, 1, 0]);
    const ids = await resolveCandidates(testApp.db, [1, 0, 0, 0, 0, 0, 0], {
      limit: 3,
    });
    expect(ids[0]).toBe(near);
    expect(ids).toEqual([near, mid, far]);
  });

  it('excludes zero-confidence stub rows', async () => {
    const keep = await seedGameWithVector('Keep', [1, 0, 0, 0, 0, 0, 0]);
    await seedGameWithVector('Stub', [0.99, 0, 0, 0, 0, 0, 0], {
      confidence: 0,
    });
    const ids = await resolveCandidates(testApp.db, [1, 0, 0, 0, 0, 0, 0], {
      limit: 5,
    });
    expect(ids).toEqual([keep]);
  });

  it('post-filters by genre IDs for hybrid strategy', async () => {
    const rpg = await seedGameWithVector('RPG', [1, 0, 0, 0, 0, 0, 0], {
      genres: [12],
    });
    const shooter = await seedGameWithVector(
      'Shooter',
      [0.9, 0, 0, 0, 0, 0, 0],
      { genres: [5] },
    );
    const ids = await resolveCandidates(testApp.db, [1, 0, 0, 0, 0, 0, 0], {
      limit: 5,
      genreIds: [12],
    });
    expect(ids).toEqual([rpg]);
    expect(ids).not.toContain(shooter);
  });

  // ROK-1127 item A1 — the multiplayer gate had no integration coverage at
  // all, which the review called the critical gap: it is a recent behaviour
  // change and it silently drops rows. `isMultiplayer` keeps a game only when
  // we KNOW max >= 2, so both a single-player game and a game with no
  // player_count at all must be rejected.
  describe('requireMultiplayer gate', () => {
    const THEME = [1, 0, 0, 0, 0, 0, 0];

    it('drops single-player games and keeps multiplayer ones', async () => {
      const solo = await seedGameWithVector('Solo Only', THEME, {
        playerCount: { min: 1, max: 1 },
      });
      const coop = await seedGameWithVector('Four Player Co-op', THEME, {
        playerCount: { min: 1, max: 4 },
      });

      const ids = await resolveCandidates(testApp.db, THEME, {
        limit: 10,
        requireMultiplayer: true,
      });

      expect(ids).toContain(coop);
      expect(ids).not.toContain(solo);
    });

    it('rejects games whose player_count is unknown', async () => {
      const unknown = await seedGameWithVector('Unknown Count', THEME, {
        playerCount: null,
      });

      const ids = await resolveCandidates(testApp.db, THEME, {
        limit: 10,
        requireMultiplayer: true,
      });

      expect(ids).not.toContain(unknown);
    });

    it('keeps single-player games when the gate is off', async () => {
      const solo = await seedGameWithVector('Solo Only', THEME, {
        playerCount: { min: 1, max: 1 },
      });

      const ids = await resolveCandidates(testApp.db, THEME, {
        limit: 10,
        requireMultiplayer: false,
      });

      expect(ids).toContain(solo);
    });
  });

  it('returns [] when the similarity query finds no candidates', async () => {
    const ids = await resolveCandidates(testApp.db, [1, 0, 0, 0, 0, 0, 0], {
      limit: 5,
    });
    expect(ids).toEqual([]);
  });
});
