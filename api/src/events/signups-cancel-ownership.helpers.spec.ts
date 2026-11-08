/**
 * Unit spec for the Discord-id signup ownership filter (ROK-2097).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { unclaimedOrOwnedBy } from './signups-ownership.helpers';

function render(clause: SQL | undefined): { sql: string; params: unknown[] } {
  if (!clause) throw new Error('expected an ownership clause, got undefined');
  return new PgDialect().sqlToQuery(clause);
}

describe('unclaimedOrOwnedBy (ROK-2097)', () => {
  it('with no caller, matches only guest signups (user_id IS NULL)', () => {
    const { sql, params } = render(unclaimedOrOwnedBy());
    expect(sql).toBe('"event_signups"."user_id" is null');
    expect(params).toEqual([]);
  });

  it("with a caller, matches guest signups OR the caller's own signup", () => {
    const { sql, params } = render(unclaimedOrOwnedBy(42));
    expect(sql).toBe(
      '("event_signups"."user_id" is null or "event_signups"."user_id" = $1)',
    );
    expect(params).toEqual([42]);
  });
});
