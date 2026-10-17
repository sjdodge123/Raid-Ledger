/**
 * ROK-1787 — guard for the correlated card subqueries. Drizzle strips the
 * table from a column interpolated into a single-table select's `sql` field,
 * so `${events.id}` inside `(select … from event_signups s …)` renders as a
 * bare `"id"` and binds to `s.id` — an uncorrelated subquery that counts the
 * wrong rows. Every correlation must render as `"events"."id"`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { recentFields, upcomingFields } from './guild-raids.queries';

function correlations(fields: Parameters<typeof select>[0]): string[] {
  const text = select(fields);
  return [...text.matchAll(/s\.event_id = ("[^"]+"(?:\."[^"]+")?)/g)].map(
    (m) => m[1] ?? '',
  );
}

function select(
  fields: ReturnType<typeof upcomingFields> | ReturnType<typeof recentFields>,
): string {
  return drizzle.mock({ schema }).select(fields).from(schema.events).toSQL()
    .sql;
}

describe('guild raid card subqueries', () => {
  it('correlate the upcoming signup count + viewer status to the outer event', () => {
    expect(correlations(upcomingFields(1))).toEqual([
      '"events"."id"',
      '"events"."id"',
    ]);
  });

  it('correlate the recent signed-up / recorded / attended counts to the outer event', () => {
    expect(correlations(recentFields())).toEqual([
      '"events"."id"',
      '"events"."id"',
      '"events"."id"',
    ]);
  });
});
