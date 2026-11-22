/**
 * Unit spec for the reminder claim's recipient re-check (ROK-2293). The
 * behaviour against a real DB lives in event-reminder.integration.spec.ts.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { recipientStillDue } from './event-reminder-dedup.helpers';

const dialect = new PgDialect();

describe('recipientStillDue (ROK-2293)', () => {
  const query = dialect.sqlToQuery(
    recipientStillDue({ eventId: 7, userId: 42 }),
  );

  it('lets the event host through without a signup', () => {
    expect(query.sql).toContain('"events"."creator_id" = $1::int OR EXISTS');
    expect(query.params[0]).toBe(42);
  });

  it('otherwise requires an active signup for this event and user', () => {
    expect(query.sql).toMatch(/"event_signups"\."event_id" = \$\d/);
    expect(query.sql).toMatch(/"event_signups"\."user_id" = \$\d/);
    expect(query.sql).toMatch(/"event_signups"\."status" in \(\$\d, \$\d\)/);
    expect(query.params.slice(1)).toEqual([7, 42, 'signed_up', 'tentative']);
  });
});
