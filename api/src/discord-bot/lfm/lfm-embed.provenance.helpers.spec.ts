/**
 * TDB:953 — the ORDER and window the two reconcile provenance lookups ask
 * Postgres for, pinned as SQL text.
 *
 * Which conversion wins is decided entirely by `ORDER BY`, so a unit spec
 * with a mocked store (`lfm-embed.reconcile.spec.ts`) cannot see it. The
 * real-Postgres behaviour (two stamped conversions after posting, the
 * EARLIEST target returned) is pinned in `lfm-embed.integration.spec.ts`;
 * this file pins the clause that produces it, so the flip `asc` -> `desc`
 * goes red on the laptop too.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import {
  conversionSincePosted,
  latestConversionTarget,
} from './lfm-embed.provenance.helpers';

const dialect = new PgDialect();
let mockDb: MockDb;

/** `ORDER BY` of the one query issued, as Postgres would receive it. */
function orderByText(): string {
  const chunks = mockDb.orderBy.mock.calls[0] as SQL[];
  return chunks.map((c) => dialect.sqlToQuery(c).sql).join(', ');
}

/** `WHERE` of the one query issued, as Postgres would receive it. */
function whereText(): string {
  return dialect.sqlToQuery(mockDb.where.mock.calls[0][0] as SQL).sql;
}

beforeEach(() => {
  mockDb = createDrizzleMock();
  mockDb.limit.mockResolvedValue([]);
});

describe('conversionSincePosted (TDB:953)', () => {
  const row = { id: 'row-1', gameId: 42 };

  it('the EARLIEST stamp in the window wins — converted_at asc, then id asc', async () => {
    await conversionSincePosted(mockDb as unknown as LfgDb, row);

    expect(orderByText()).toBe(
      '"lfg_intents"."converted_at" asc, "lfg_intents"."id" asc',
    );
  });

  it('matches stamped rows from two minutes before the post — the LFG-Now spawn order', async () => {
    await conversionSincePosted(mockDb as unknown as LfgDb, row);

    expect(whereText()).toContain(
      `"lfg_intents"."converted_at" > "lfg_group_messages"."posted_at" - interval '2 minutes'`,
    );
    // Above the floor an `expires_at` leg would admit an older corpse.
    expect(whereText()).not.toContain('expires_at');
  });

  it('maps the provenance row to the target convertedView renders', async () => {
    mockDb.limit.mockResolvedValue([{ pollId: 7, eventId: null }]);

    await expect(
      conversionSincePosted(mockDb as unknown as LfgDb, row),
    ).resolves.toEqual({ pollId: 7 });
  });
});

describe('latestConversionTarget (TDB:953 / D9)', () => {
  const postedAt = new Date('2026-10-08T12:00:00Z');

  it('a stamped match outranks a NULL one, earliest stamp first; NULL rows newest id first', async () => {
    await latestConversionTarget(mockDb as unknown as LfgDb, 42, postedAt);

    expect(orderByText()).toBe(
      '"lfg_intents"."converted_at" asc nulls last, "lfg_intents"."id" desc',
    );
  });

  it('keeps the expires_at leg for EVERY row, stamped or not', async () => {
    await latestConversionTarget(mockDb as unknown as LfgDb, 42, postedAt);

    expect(whereText()).toContain(
      '("lfg_intents"."converted_at" > $3 or "lfg_intents"."expires_at" > $4)',
    );
    expect(whereText()).not.toContain('is null');
  });
});
