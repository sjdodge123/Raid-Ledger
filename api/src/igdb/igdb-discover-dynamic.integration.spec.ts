/**
 * Integration test for the dynamic-row merge in `GET /games/discover` (ROK-567).
 * Confirms that approved + non-expired `discovery_category_suggestions` rows
 * appear alongside the existing static rows in the discover response.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

describe('GET /games/discover dynamic rows (ROK-567)', () => {
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
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
      .returning();
    await testApp.db.execute(sql`
      INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
      VALUES (
        ${game.id},
        ${`[${vector.join(',')}]`}::vector,
        '{}'::jsonb,
        0.9,
        ${`h-${game.id}`}
      )
    `);
    return game.id;
  }

  it('includes an approved dynamic row alongside static rows', async () => {
    const gameId = await seedGameWithVector('Dynamic Candidate', [
      1, 0, 0, 0, 0, 0, 0,
    ]);
    const [sugg] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: 'Dynamic Row Category',
        description: 'x',
        categoryType: 'trend',
        themeVector: [1, 0, 0, 0, 0, 0, 0],
        status: 'approved',
        populationStrategy: 'fixed',
        sortOrder: 2000,
        candidateGameIds: [gameId],
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });

    const res = await testApp.request.get('/games/discover');
    expect(res.status).toBe(200);
    const rows = (res.body as { rows: Array<{ category: string; isDynamic?: boolean; suggestionId?: string }> }).rows;
    const dynamicRow = rows.find((r) => r.category === 'Dynamic Row Category');
    expect(dynamicRow).toBeDefined();
    expect(dynamicRow?.isDynamic).toBe(true);
    expect(dynamicRow?.suggestionId).toBe(sugg.id);
  });

  it('omits expired approved rows from discover', async () => {
    const gameId = await seedGameWithVector('Stale', [1, 0, 0, 0, 0, 0, 0]);
    await testApp.db.insert(schema.discoveryCategorySuggestions).values({
      name: 'Expired Dynamic',
      description: 'x',
      categoryType: 'trend',
      themeVector: [1, 0, 0, 0, 0, 0, 0],
      status: 'approved',
      populationStrategy: 'fixed',
      candidateGameIds: [gameId],
      expiresAt: new Date(Date.now() - 10_000),
    });
    const res = await testApp.request.get('/games/discover');
    expect(res.status).toBe(200);
    const rows = (res.body as { rows: Array<{ category: string }> }).rows;
    expect(rows.find((r) => r.category === 'Expired Dynamic')).toBeUndefined();
  });
});
