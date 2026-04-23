/**
 * Integration tests for `loadApprovedDynamicRows` (ROK-567). Seeds approved
 * discovery-category rows alongside game_taste_vectors and asserts that each
 * row renders with the right population strategy + sort order + dynamic
 * markers.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { loadApprovedDynamicRows } from './discovery-categories.discover.helpers';

describe('loadApprovedDynamicRows (ROK-567)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedGameVector(
    name: string,
    vector: number[],
    opts: { confidence?: number; hidden?: boolean } = {},
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        hidden: opts.hidden ?? false,
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

  async function seedSuggestion(opts: {
    name: string;
    status?: 'pending' | 'approved' | 'rejected' | 'expired';
    strategy?: 'vector' | 'fixed' | 'hybrid';
    sortOrder?: number;
    candidateGameIds?: number[];
    themeVector?: number[];
    expiresAt?: Date | null;
  }): Promise<string> {
    const [row] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: opts.name,
        description: 'test',
        categoryType: 'trend',
        themeVector:
          opts.themeVector ?? [1, 0, 0, 0, 0, 0, 0],
        status: opts.status ?? 'approved',
        populationStrategy: opts.strategy ?? 'vector',
        sortOrder: opts.sortOrder ?? 1000,
        candidateGameIds: opts.candidateGameIds ?? [],
        expiresAt: opts.expiresAt ?? null,
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return row.id;
  }

  it('returns empty when no approved rows exist', async () => {
    await seedSuggestion({ name: 'Pending Only', status: 'pending' });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows).toEqual([]);
  });

  it('vector strategy re-queries live similarity and hydrates games', async () => {
    const near = await seedGameVector('Near Game', [1, 0, 0, 0, 0, 0, 0]);
    const id = await seedSuggestion({
      name: 'Near Theme',
      strategy: 'vector',
    });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('Near Theme');
    expect(rows[0].slug).toBe(`dynamic-${id}`);
    expect(rows[0].suggestionId).toBe(id);
    expect(rows[0].isDynamic).toBe(true);
    expect(rows[0].games.map((g) => g.id)).toEqual([near]);
  });

  it('fixed strategy returns games in the stored candidate order', async () => {
    const a = await seedGameVector('A', [1, 0, 0, 0, 0, 0, 0]);
    const b = await seedGameVector('B', [0, 1, 0, 0, 0, 0, 0]);
    await seedSuggestion({
      name: 'Curated',
      strategy: 'fixed',
      candidateGameIds: [b, a],
    });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows[0].games.map((g) => g.id)).toEqual([b, a]);
  });

  it('filters hidden games out of fixed-strategy rows', async () => {
    const visible = await seedGameVector('Vis', [1, 0, 0, 0, 0, 0, 0]);
    const hidden = await seedGameVector('Hidden', [1, 0, 0, 0, 0, 0, 0], {
      hidden: true,
    });
    await seedSuggestion({
      name: 'Mixed Visibility',
      strategy: 'fixed',
      candidateGameIds: [hidden, visible],
    });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows[0].games.map((g) => g.id)).toEqual([visible]);
  });

  it('filters out rows whose expires_at has passed', async () => {
    await seedGameVector('G', [1, 0, 0, 0, 0, 0, 0]);
    await seedSuggestion({
      name: 'Expired',
      expiresAt: new Date(Date.now() - 10_000),
    });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows).toEqual([]);
  });

  it('orders rows by stored sort_order ascending', async () => {
    await seedGameVector('G', [1, 0, 0, 0, 0, 0, 0]);
    await seedSuggestion({ name: 'Second', sortOrder: 2000 });
    await seedSuggestion({ name: 'First', sortOrder: 500 });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows.map((r) => r.category)).toEqual(['First', 'Second']);
  });

  it('omits rows that resolve to zero games', async () => {
    await seedSuggestion({ name: 'No Games', strategy: 'vector' });
    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(rows).toEqual([]);
  });
});
