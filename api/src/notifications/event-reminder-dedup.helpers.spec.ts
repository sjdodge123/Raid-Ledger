/**
 * Unit spec for the reminder claim's recipient re-check (ROK-2293). The
 * behaviour against a real DB lives in event-reminder.integration.spec.ts.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  claimReminderDedup,
  recipientStillDue,
} from './event-reminder-dedup.helpers';

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

describe('claimReminderDedup result (ROK-2293)', () => {
  const input = {
    eventId: 7,
    userId: 42,
    windowType: '15min',
    startTime: new Date('2026-11-21T12:15:00Z'),
    now: new Date('2026-11-21T12:00:00Z'),
  };
  const claimWith = (rows: unknown[]) => {
    const execute = jest.fn().mockResolvedValue(rows);
    const db = { execute } as unknown as Parameters<
      typeof claimReminderDedup
    >[0];
    return { execute, result: claimReminderDedup(db, input) };
  };

  it('reports claimed + fresh from the claim row', async () => {
    const { result } = claimWith([{ id: 1, fresh: true }]);
    expect(await result).toEqual({ claimed: true, fresh: true });
  });

  it('reports claimed, not fresh, when the current signup is past the grace', async () => {
    const { result } = claimWith([{ id: 1, fresh: false }]);
    expect(await result).toEqual({ claimed: true, fresh: false });
  });

  it('reports nothing claimed when no row was inserted', async () => {
    const { result } = claimWith([]);
    expect(await result).toEqual({ claimed: false, fresh: false });
  });

  it('computes freshness in the RETURNING clause against now - grace', async () => {
    const { execute, result } = claimWith([]);
    await result;
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(query.sql).toMatch(/RETURNING id, EXISTS \(/);
    expect(query.sql).toContain('"event_signups"."activated_at" >');
    expect(query.params).toContain('2026-11-21T11:45:00.000Z');
  });
});
