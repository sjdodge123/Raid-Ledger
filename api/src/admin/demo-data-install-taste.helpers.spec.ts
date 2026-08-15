/**
 * Specs for the demo-mode taste-signal install helpers (ROK-1105).
 *
 * Focuses on `refreshArchetypesFromCurrentMetrics`, which was rewritten to
 * batch all per-user archetype updates into a single
 * `UPDATE ... FROM (VALUES ...)` round-trip instead of one UPDATE per row.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import {
  TASTE_PROFILE_AXIS_POOL,
  type IntensityMetricsDto,
  type TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { deriveArchetype } from '../taste-profile/archetype.helpers';
import { refreshArchetypesFromCurrentMetrics } from './demo-data-install-taste.helpers';

type Db = PostgresJsDatabase<typeof schema>;

function makeDimensions(
  overrides: Partial<TasteProfileDimensionsDto> = {},
): TasteProfileDimensionsDto {
  const base = Object.fromEntries(
    TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, 0]),
  ) as TasteProfileDimensionsDto;
  return { ...base, ...overrides };
}

function makeMetrics(intensity: number): IntensityMetricsDto {
  return { intensity, focus: 50, breadth: 50, consistency: 50 };
}

const VECTOR_ROWS = [
  {
    userId: 1,
    dimensions: makeDimensions({ mmo: 90 }),
    intensityMetrics: makeMetrics(90),
  },
  {
    userId: 2,
    dimensions: makeDimensions(),
    intensityMetrics: makeMetrics(10),
  },
  {
    userId: 3,
    dimensions: makeDimensions({ pvp: 45 }),
    intensityMetrics: makeMetrics(60),
  },
];

describe('refreshArchetypesFromCurrentMetrics (ROK-1105 batched)', () => {
  let mockDb: MockDb;
  let db: Db;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    db = mockDb as unknown as Db;
    mockDb.execute.mockResolvedValue(undefined);
  });

  it('returns 0 and issues no UPDATE when no vectors exist', async () => {
    mockDb.from.mockResolvedValue([]);
    await expect(refreshArchetypesFromCurrentMetrics(db)).resolves.toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('batches every archetype update into a single round-trip', async () => {
    mockDb.from.mockResolvedValue(VECTOR_ROWS);
    await expect(refreshArchetypesFromCurrentMetrics(db)).resolves.toBe(3);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('parameterizes one (user_id, archetype) tuple per row with the derived archetype', async () => {
    mockDb.from.mockResolvedValue(VECTOR_ROWS);
    await refreshArchetypesFromCurrentMetrics(db);
    const sqlArg = mockDb.execute.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(sqlArg);
    const lowered = query.sql.toLowerCase();
    expect(lowered).toContain('update ');
    expect(lowered).toContain('"player_taste_vectors"');
    expect(lowered).toContain('from (values');
    // 3 rows x (user_id, archetype json).
    expect(query.params).toHaveLength(6);
    expect(query.params[0]).toBe(1);
    expect(query.params[2]).toBe(2);
    expect(query.params[4]).toBe(3);
    for (const [i, row] of VECTOR_ROWS.entries()) {
      const archetype = JSON.parse(query.params[i * 2 + 1] as string);
      expect(archetype).toEqual(
        deriveArchetype({
          intensityMetrics: row.intensityMetrics,
          dimensions: row.dimensions,
        }),
      );
    }
  });

  it('derives tier-correct archetypes from the current metrics', async () => {
    mockDb.from.mockResolvedValue(VECTOR_ROWS);
    await refreshArchetypesFromCurrentMetrics(db);
    const sqlArg = mockDb.execute.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(sqlArg);
    const tiers = [1, 3, 5].map(
      (i) =>
        (JSON.parse(query.params[i] as string) as { intensityTier: string })
          .intensityTier,
    );
    expect(tiers).toEqual(['Hardcore', 'Casual', 'Dedicated']);
  });
});
