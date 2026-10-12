/**
 * Unit tests for the weekly-digest "Coming up" reads (ROK-1771 slice L1).
 * Behaviour against real rows lives in
 * `weekly-digest-v2-reads.integration.spec.ts`; these pin the SQL shape and
 * the row shaping (incl. empty input → null).
 */
import { and, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  UPCOMING_POLL_LIMIT,
  buildUpcomingPollsQuery,
  shapeUpcomingEvent,
  shapeWeeklyUpcoming,
  upcomingEventConditions,
  type UpcomingEventRow,
  type UpcomingPollRow,
} from './weekly-digest-upcoming.helpers';
import { defined } from '../common/testing/narrow';
import { votableStandalonePollSql } from '../lineups/standalone-poll/standalone-poll-votable.helpers';

function render(query: SQL): { text: string; params: unknown[] } {
  const out = new PgDialect().sqlToQuery(query);
  return { text: out.sql.replace(/\s+/g, ' '), params: out.params };
}

const NOW = new Date('2026-10-12T18:00:00.000Z');

function eventRow(over: Partial<UpcomingEventRow> = {}): UpcomingEventRow {
  return {
    id: 1,
    title: 'Raid night',
    gameName: 'WoW',
    startsAtMs: NOW.getTime() + 3_600_000,
    signupCount: 4,
    ...over,
  };
}

function pollRow(over: Partial<UpcomingPollRow> = {}): UpcomingPollRow {
  return {
    matchId: 9,
    lineupId: 3,
    gameName: 'Valheim',
    deadlineMs: NOW.getTime() + 86_400_000,
    memberCount: 5,
    openSlotCount: 2,
    ...over,
  };
}

describe('upcomingEventConditions', () => {
  const { text, params } = render(
    defined(and(...upcomingEventConditions(NOW)), 'conditions'),
  );

  it('bounds the event start to [now, now + 7 days]', () => {
    expect(text).toContain('lower("events"."duration") >=');
    expect(text).toContain('lower("events"."duration") <=');
    expect(params).toContain('2026-10-12T18:00:00.000Z');
    expect(params).toContain('2026-10-19T18:00:00.000Z');
  });

  it('excludes cancelled and ad-hoc events', () => {
    expect(text).toContain('"events"."cancelled_at" IS NULL');
    expect(text).toContain('"events"."is_ad_hoc" =');
    expect(params).toContain(false);
  });
});

describe('buildUpcomingPollsQuery', () => {
  const { text, params } = render(buildUpcomingPollsQuery());

  it('reuses the shared votable predicate verbatim', () => {
    const votable = render(votableStandalonePollSql()).text.trim();
    expect(text).toContain(votable);
  });

  it('lists public polls only', () => {
    expect(text).toContain("AND l.visibility = 'public'");
  });

  it('orders by deadline (no-deadline last) and caps the list', () => {
    expect(text).toContain('ORDER BY l.phase_deadline ASC NULLS LAST');
    expect(text).toContain(`LIMIT ${UPCOMING_POLL_LIMIT}`);
    expect(params).toEqual([]);
  });

  it('selects no voter or member names', () => {
    expect(text).not.toMatch(/username|display_name/);
  });
});

describe('shapeUpcomingEvent', () => {
  it('maps a row to a UTC instant and numeric count', () => {
    const shaped = shapeUpcomingEvent(
      eventRow({ startsAtMs: String(NOW.getTime()), signupCount: '7' }),
    );
    expect(shaped).toEqual({
      eventId: 1,
      title: 'Raid night',
      gameName: 'WoW',
      startsAt: NOW,
      signupCount: 7,
    });
  });

  it('drops a row whose start is missing or junk', () => {
    expect(shapeUpcomingEvent(eventRow({ startsAtMs: null }))).toBeNull();
    expect(shapeUpcomingEvent(eventRow({ startsAtMs: 'abc' }))).toBeNull();
  });
});

describe('shapeWeeklyUpcoming', () => {
  it('returns null when there are no events and no polls', () => {
    expect(shapeWeeklyUpcoming([], [])).toBeNull();
  });

  it('returns null when every event row is unusable and there are no polls', () => {
    expect(
      shapeWeeklyUpcoming([eventRow({ startsAtMs: null })], []),
    ).toBeNull();
  });

  it('keeps polls-only weeks (no events)', () => {
    const out = shapeWeeklyUpcoming([], [pollRow({ deadlineMs: null })]);
    expect(out).toEqual({
      events: [],
      polls: [
        {
          matchId: 9,
          lineupId: 3,
          gameName: 'Valheim',
          deadline: null,
          memberCount: 5,
          openSlotCount: 2,
        },
      ],
    });
  });

  it('shapes the deadline as a Date and coerces junk counts to 0', () => {
    const out = shapeWeeklyUpcoming(
      [eventRow()],
      [pollRow({ memberCount: null, openSlotCount: 'x' })],
    );
    expect(out?.events).toHaveLength(1);
    expect(out?.polls[0]?.deadline).toEqual(
      new Date(NOW.getTime() + 86_400_000),
    );
    expect(out?.polls[0]?.memberCount).toBe(0);
    expect(out?.polls[0]?.openSlotCount).toBe(0);
  });
});
