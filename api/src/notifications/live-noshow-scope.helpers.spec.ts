/**
 * Unit tests for the shared live no-show signup scope (TDB:372).
 *
 * Renders the predicate each phase applies and asserts it carries the
 * status + bench filter. The end-to-end behaviour (a benched / roached-out
 * player is not named in the Phase 2 alert) is covered against a real DB in
 * live-noshow-running-late.integration.spec.ts.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { activeNonBenchSignup } from './live-noshow-scope.helpers';
import { getPhase1RemindedUserIds } from './live-noshow.helpers';

const dialect = new PgDialect();

function expectActiveNonBench(query: { sql: string; params: unknown[] }) {
  expect(query.sql).toContain('"event_signups"."status" = $');
  expect(query.params).toContain('signed_up');
  expect(query.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "roster_assignments"/);
  expect(query.sql).toContain(`"roster_assignments"."role" = 'bench'`);
}

describe('activeNonBenchSignup', () => {
  it('filters to signed-up signups with no bench assignment', () => {
    expectActiveNonBench(dialect.sqlToQuery(activeNonBenchSignup()));
  });
});

describe('getPhase1RemindedUserIds', () => {
  it('only returns reminded users who are still active, non-bench signups', async () => {
    let joinOn: SQL | undefined;
    let predicate: SQL | undefined;
    const chain = {
      innerJoin: (_table: unknown, on: SQL) => {
        joinOn = on;
        return chain;
      },
      where: (w: SQL) => {
        predicate = w;
        return Promise.resolve([{ userId: 7 }]);
      },
    };
    const db = {
      select: () => ({ from: () => chain }),
    } as unknown as PostgresJsDatabase<typeof schema>;

    const ids = await getPhase1RemindedUserIds(db, 42);

    expect(ids).toEqual([7]);
    expect(joinOn).toBeDefined();
    const on = dialect.sqlToQuery(joinOn as SQL).sql;
    expect(on).toContain(
      '"event_signups"."event_id" = "event_reminders_sent"."event_id"',
    );
    expect(on).toContain(
      '"event_signups"."user_id" = "event_reminders_sent"."user_id"',
    );
    const where = dialect.sqlToQuery(predicate as SQL);
    expect(where.params).toContain('noshow_reminder');
    expectActiveNonBench(where);
  });
});
