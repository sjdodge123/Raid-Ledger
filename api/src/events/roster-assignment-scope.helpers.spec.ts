/**
 * Unit spec for the event-scoped roster lookup (ROK-2321): a signup-keyed
 * roster read must also match the event, so a row another event holds for
 * the same signup id can never answer for it.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  assignmentOfSignupInEvent,
  hasAssignmentInEvent,
} from './roster-assignment-scope.helpers';
import { getAssignedSlotRole } from './signups-roster-query.helpers';
import { findAssignmentForSignup } from './signups-cancel.helpers';

function render(clause: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(clause);
}

const SCOPED_SQL =
  '("roster_assignments"."event_id" = $1 and "roster_assignments"."signup_id" = $2)';

/** Mock select().from().where(w).limit() that records the where clause. */
function recordingDb(rows: unknown[]) {
  const seen: SQL[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          seen.push(w);
          return { limit: () => Promise.resolve(rows) };
        },
      }),
    }),
  };
  return { db, seen };
}

function onlyClause(seen: SQL[]): SQL {
  const [first] = seen;
  if (!first || seen.length !== 1) {
    throw new Error(`expected one where clause, got ${seen.length}`);
  }
  return first;
}

describe('assignmentOfSignupInEvent (ROK-2321)', () => {
  it('matches the signup only within the given event', () => {
    const { sql, params } = render(assignmentOfSignupInEvent(11, 42));
    expect(sql).toBe(SCOPED_SQL);
    expect(params).toEqual([11, 42]);
  });
});

describe('signup-keyed roster readers filter by event (ROK-2321)', () => {
  it('getAssignedSlotRole scopes its lookup to the event', async () => {
    const { db, seen } = recordingDb([{ role: 'dps' }]);
    const role = await getAssignedSlotRole(
      db as unknown as Parameters<typeof getAssignedSlotRole>[0],
      11,
      42,
    );
    expect(role).toBe('dps');
    expect(render(onlyClause(seen))).toMatchObject({
      sql: SCOPED_SQL,
      params: [11, 42],
    });
  });

  it('findAssignmentForSignup scopes its lookup to the event', async () => {
    const { db, seen } = recordingDb([]);
    const found = await findAssignmentForSignup(
      db as unknown as Parameters<typeof findAssignmentForSignup>[0],
      11,
      42,
    );
    expect(found).toBeNull();
    expect(render(onlyClause(seen))).toMatchObject({
      sql: SCOPED_SQL,
      params: [11, 42],
    });
  });
});

describe('hasAssignmentInEvent (ROK-2321)', () => {
  it('scopes its lookup to the event and reports a hit', async () => {
    const { db, seen } = recordingDb([{ id: 1 }]);
    const has = await hasAssignmentInEvent(
      db as unknown as Parameters<typeof hasAssignmentInEvent>[0],
      11,
      42,
    );
    expect(has).toBe(true);
    expect(render(onlyClause(seen))).toMatchObject({
      sql: SCOPED_SQL,
      params: [11, 42],
    });
  });
});
