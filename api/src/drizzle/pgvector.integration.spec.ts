/**
 * pgvector Integration Tests (ROK-948)
 *
 * Verifies that migration 0120 enables the pgvector extension and that the
 * `vector` type is usable against the running Postgres instance. This guards
 * the infrastructure change that underpins the upcoming player_taste_vectors
 * table and its cosine-similarity queries.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';

describe('pgvector extension (ROK-948)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  it('is installed by migration 0120', async () => {
    const rows = await testApp.db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].extname).toBe('vector');
  });

  it('supports vector(7) casts and cosine distance operator', async () => {
    const rows = await testApp.db.execute<{
      identical: string;
      partial: string;
      orthogonal: string;
    }>(sql`
      SELECT
        ('[1,0,0,0,0,0,0]'::vector(7) <=> '[1,0,0,0,0,0,0]'::vector(7))::text AS identical,
        ('[1,0,0,0,0,0,0]'::vector(7) <=> '[1,1,0,0,0,0,0]'::vector(7))::text AS partial,
        ('[1,0,0,0,0,0,0]'::vector(7) <=> '[0,0,0,0,0,0,1]'::vector(7))::text AS orthogonal
    `);
    const [row] = rows;
    expect(Number(row.identical)).toBeCloseTo(0);
    expect(Number(row.partial)).toBeGreaterThan(0);
    expect(Number(row.partial)).toBeLessThan(1);
    expect(Number(row.orthogonal)).toBeCloseTo(1);
  });
});
