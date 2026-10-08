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

/** `ORDER BY` keys of the one query issued, as Postgres would receive them. */
function orderByKeys(): string[] {
  const chunks = mockDb.orderBy.mock.calls[0] as SQL[];
  return chunks.map((c) => dialect.sqlToQuery(c).sql);
}

/** The whole `ORDER BY`, keys joined. */
function orderByText(): string {
  return orderByKeys().join(', ');
}

/** Tier 1 of the two-tier rank: stamped after `bound` first, earliest first. */
function afterBoundTier(bound: string): string {
  const after = `"lfg_intents"."converted_at" > ${bound}`;
  return [
    `case when ${after} then 0 else 1 end`,
    `case when ${after} then "lfg_intents"."converted_at" end asc nulls last`,
  ].join(', ');
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

  it('a strictly-later conversion outranks a grace-window corpse; the EARLIEST strictly-later wins (Codex P2)', async () => {
    await conversionSincePosted(mockDb as unknown as LfgDb, row);

    // Tier 1 bounds on posted_at itself — NO grace — so a stamp inside the
    // grace window (possibly an older group's corpse) ranks below it.
    expect(orderByText()).toBe(
      `${afterBoundTier('"lfg_group_messages"."posted_at"')}, "lfg_intents"."id" desc`,
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

  it("the row's OWN later conversion outranks an older corpse the expires_at leg admits (Codex P2)", async () => {
    await latestConversionTarget(mockDb as unknown as LfgDb, 42, postedAt);

    // Tier 1 = stamped after postedAfter, earliest first; a corpse converted
    // before the post (hands unexpired) can only reach tier 2.
    expect(orderByKeys().slice(0, 2).join(', ')).toBe(afterBoundTier('$1'));
    // ...bound on the SAME instant the WHERE's converted_at leg uses.
    const [tier] = mockDb.orderBy.mock.calls[0] as [SQL, ...SQL[]];
    const tierParams = dialect.sqlToQuery(tier).params;
    const whereParams = dialect.sqlToQuery(
      mockDb.where.mock.calls[0][0] as SQL,
    ).params;
    expect(tierParams).toEqual([whereParams[2]]);
  });

  it('NULL-stamped rows and the expires_at fallback rank last, newest id first (D9)', async () => {
    await latestConversionTarget(mockDb as unknown as LfgDb, 42, postedAt);

    // NULL > $1 is NULL, so the CASE falls to `else 1`: tier 2, id desc.
    expect(orderByText()).toBe(
      `${afterBoundTier('$1')}, "lfg_intents"."id" desc`,
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
