/**
 * Unit tests for the weekly-digest recap helpers (ROK-1435 slice L1).
 * The query's behaviour against real rows lives in
 * `weekly-digest.integration.spec.ts`; these pin the SQL shape, the
 * privacy-parameter branching and the row shaping.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import {
  RECAP_WINDOW_DAYS,
  SHOWS_ACTIVITY_SQL,
  buildWeeklyRecapQuery,
  fetchWeeklyRecap,
  isEmptyWeeklyRecap,
  shapeWeeklyRecap,
  type WeeklyRecapRow,
} from './weekly-digest-recap.helpers';
import { at } from '../common/testing/narrow';

function render(respectActivityOptOut?: boolean): string {
  const query = buildWeeklyRecapQuery(
    respectActivityOptOut === undefined ? {} : { respectActivityOptOut },
  );
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/g, ' ');
}

describe('buildWeeklyRecapQuery', () => {
  it('uses a 7-day window ending now on the event end time', () => {
    expect(RECAP_WINDOW_DAYS).toBe(7);
    const text = render();
    expect(text).toContain("upper(e.duration) >= (NOW() - INTERVAL '7 days')");
    expect(text).toContain('upper(e.duration) <= NOW()');
  });

  it('adds a GiST-indexable overlap on the window, keeping the exact bounds', () => {
    const text = render();
    expect(text).toContain(
      "e.duration && tsrange((NOW() - INTERVAL '7 days')::timestamp, NOW()::timestamp, '[]')",
    );
    expect(text).toContain('upper(e.duration) <= NOW()');
  });

  it('counts only members still in the guild (not deactivated, banned or kicked)', () => {
    const text = render();
    expect(text).toContain('INNER JOIN users u ON u.id = s.user_id');
    expect(text).toContain('u.deactivated_at IS NULL');
    expect(text).toContain('u.banned_at IS NULL');
    expect(text).toContain('u.kicked_at IS NULL');
  });

  it('counts only attended, linked, non-cancelled signups', () => {
    const text = render();
    expect(text).toContain("s.attendance_status = 'attended'");
    expect(text).toContain('s.user_id IS NOT NULL');
    expect(text).toContain('e.cancelled_at IS NULL');
  });

  it('applies the show_activity opt-out predicate by default', () => {
    expect(render()).toContain('sa_pref.user_id = a.user_id');
    expect(render()).toContain("sa_pref.key = 'show_activity'");
    expect(render()).toContain("sa_pref.value = 'false'::jsonb");
  });

  it('applies the opt-out predicate when respectActivityOptOut is true', () => {
    expect(render(true)).toContain("sa_pref.key = 'show_activity'");
  });

  it('omits the opt-out predicate when respectActivityOptOut is false', () => {
    const text = render(false);
    expect(text).not.toContain('show_activity');
    expect(text).not.toContain('user_preferences');
    expect(text).toContain('FROM filtered');
  });

  it('casts every aggregate to int so postgres-js does not return text', () => {
    const text = render();
    expect(text).toContain('COUNT(DISTINCT event_id)::int AS events_run');
    expect(text).toContain('COUNT(DISTINCT user_id)::int AS players_attended');
    expect(text).toContain('COUNT(*)::int AS attendances');
  });

  it('binds no parameters (the window is a constant, not user input)', () => {
    const { params } = new PgDialect().sqlToQuery(buildWeeklyRecapQuery());
    expect(params).toEqual([]);
  });
});

describe('buildWeeklyRecapQuery — endOffsetDays (ROK-1771 C1)', () => {
  function renderOffset(endOffsetDays: number): string {
    return new PgDialect()
      .sqlToQuery(buildWeeklyRecapQuery({ endOffsetDays }))
      .sql.replace(/\s+/g, ' ');
  }

  it('offset 0 renders exactly the default current-week query', () => {
    expect(renderOffset(0)).toBe(render());
  });

  it('offset 7 shifts both bounds back a week: [NOW()-14d, NOW()-7d]', () => {
    const text = renderOffset(7);
    expect(text).toContain(
      "e.duration && tsrange((NOW() - INTERVAL '14 days')::timestamp, (NOW() - INTERVAL '7 days')::timestamp, '[]')",
    );
    expect(text).toContain("upper(e.duration) >= (NOW() - INTERVAL '14 days')");
    expect(text).toContain("upper(e.duration) <= (NOW() - INTERVAL '7 days')");
    expect(text).not.toContain('upper(e.duration) <= NOW()');
  });

  it('keeps the privacy predicate and binds no parameters when shifted', () => {
    const query = buildWeeklyRecapQuery({ endOffsetDays: 7 });
    const { sql: text, params } = new PgDialect().sqlToQuery(query);
    expect(text).toContain("sa_pref.key = 'show_activity'");
    expect(params).toEqual([]);
  });

  it('rejects a negative or fractional offset', () => {
    expect(() => buildWeeklyRecapQuery({ endOffsetDays: -1 })).toThrow(
      /endOffsetDays/,
    );
    expect(() => buildWeeklyRecapQuery({ endOffsetDays: 1.5 })).toThrow(
      /endOffsetDays/,
    );
  });
});

describe('SHOWS_ACTIVITY_SQL', () => {
  function text(ref: string): string {
    return new PgDialect()
      .sqlToQuery(SHOWS_ACTIVITY_SQL(ref))
      .sql.replace(/\s+/g, ' ');
  }

  it('is a NOT EXISTS on the show_activity=false preference of the given column', () => {
    const out = text('x.user_id');
    expect(out).toContain(
      'NOT EXISTS ( SELECT 1 FROM user_preferences sa_pref',
    );
    expect(out).toContain('sa_pref.user_id = x.user_id');
    expect(out).toContain("sa_pref.key = 'show_activity'");
    expect(out).toContain("sa_pref.value = 'false'::jsonb");
  });

  it('binds no parameters', () => {
    expect(
      new PgDialect().sqlToQuery(SHOWS_ACTIVITY_SQL('a.user_id')).params,
    ).toEqual([]);
  });

  it('rejects anything that is not a bare alias.column reference', () => {
    expect(() => SHOWS_ACTIVITY_SQL('user_id')).toThrow(
      /not a column reference/,
    );
    expect(() => SHOWS_ACTIVITY_SQL('a.user_id OR 1=1')).toThrow(
      /not a column reference/,
    );
  });
});

describe('shapeWeeklyRecap', () => {
  it('maps snake_case aggregates to a typed recap', () => {
    const row: WeeklyRecapRow = {
      events_run: 3,
      players_attended: 5,
      attendances: 9,
    };
    expect(shapeWeeklyRecap(row)).toEqual({
      eventsRun: 3,
      playersAttended: 5,
      attendances: 9,
    });
  });

  it('coerces bigint-as-text aggregates to numbers', () => {
    const shaped = shapeWeeklyRecap({
      events_run: '2',
      players_attended: '4',
      attendances: '6',
    });
    expect(shaped).toEqual({
      eventsRun: 2,
      playersAttended: 4,
      attendances: 6,
    });
    expect(typeof shaped.eventsRun).toBe('number');
  });

  it('returns zeros when the query yields no row', () => {
    expect(shapeWeeklyRecap(undefined)).toEqual({
      eventsRun: 0,
      playersAttended: 0,
      attendances: 0,
    });
  });

  it('treats null, negative and non-numeric aggregates as 0', () => {
    expect(
      shapeWeeklyRecap({
        events_run: null,
        players_attended: -1,
        attendances: 'abc',
      }),
    ).toEqual({ eventsRun: 0, playersAttended: 0, attendances: 0 });
  });
});

describe('isEmptyWeeklyRecap', () => {
  it('is true when no events ran', () => {
    expect(
      isEmptyWeeklyRecap({ eventsRun: 0, playersAttended: 0, attendances: 0 }),
    ).toBe(true);
  });

  it('is false when at least one event ran', () => {
    expect(
      isEmptyWeeklyRecap({ eventsRun: 1, playersAttended: 2, attendances: 2 }),
    ).toBe(false);
  });
});

describe('fetchWeeklyRecap', () => {
  function mockDb(rows: WeeklyRecapRow[]) {
    const execute = jest
      .fn<Promise<WeeklyRecapRow[]>, [SQL]>()
      .mockResolvedValue(rows);
    const db = { execute } as unknown as PostgresJsDatabase<typeof schema>;
    return { db, execute };
  }

  it('executes the default (opt-out respecting) query and shapes row 0', async () => {
    const { db, execute } = mockDb([
      { events_run: 1, players_attended: 2, attendances: 3 },
    ]);
    const recap = await fetchWeeklyRecap(db);
    expect(recap).toEqual({ eventsRun: 1, playersAttended: 2, attendances: 3 });
    const sent = new PgDialect().sqlToQuery(at(execute.mock.calls, 0)[0]).sql;
    expect(sent).toContain('show_activity');
  });

  it('passes endOffsetDays through to the query (prior-week window)', async () => {
    const { db, execute } = mockDb([]);
    await fetchWeeklyRecap(db, { endOffsetDays: 7 });
    const sent = new PgDialect().sqlToQuery(at(execute.mock.calls, 0)[0]).sql;
    expect(sent).toContain("INTERVAL '14 days'");
  });

  it('passes respectActivityOptOut=false through to the query', async () => {
    const { db, execute } = mockDb([]);
    const recap = await fetchWeeklyRecap(db, { respectActivityOptOut: false });
    expect(recap).toEqual({ eventsRun: 0, playersAttended: 0, attendances: 0 });
    const sent = new PgDialect().sqlToQuery(at(execute.mock.calls, 0)[0]).sql;
    expect(sent).not.toContain('show_activity');
  });
});
