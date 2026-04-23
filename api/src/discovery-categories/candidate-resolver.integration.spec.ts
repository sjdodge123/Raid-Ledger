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
    opts: { genres?: number[]; confidence?: number } = {},
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        genres: opts.genres ?? [],
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

  it('returns [] when the similarity query finds no candidates', async () => {
    const ids = await resolveCandidates(testApp.db, [1, 0, 0, 0, 0, 0, 0], {
      limit: 5,
    });
    expect(ids).toEqual([]);
  });
});
