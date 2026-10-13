/**
 * Unit tests for the weekly-digest "Firsts & milestones" reads (ROK-1771 L2).
 * Behaviour against real rows lives in
 * `weekly-digest-milestones.integration.spec.ts`; these pin the threshold
 * math, the caps, the empty cases and the privacy predicate in every query.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  EVENT_MILESTONE_THRESHOLDS,
  HOUR_MILESTONE_THRESHOLDS,
  MILESTONE_LIST_CAP,
  NEW_MEMBER_NAME_CAP,
  crossedThreshold,
  emptyDigestMilestones,
  isEmptyDigestMilestones,
  shapeEventMilestones,
  shapeFirstGames,
  shapeHourMilestones,
  shapeNewMembers,
} from './weekly-digest-milestones.helpers';
import {
  buildEventMilestonesQuery,
  buildFirstGamesQuery,
  buildHourMilestonesQuery,
  buildNewMembersQuery,
} from './weekly-digest-milestones-sql.helpers';

const H = 3600;

function render(query: SQL): string {
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/g, ' ');
}

describe('milestone thresholds (Q8 ruling)', () => {
  it('pins 10/25/50 events and 100/250/500/1000 hours', () => {
    expect(EVENT_MILESTONE_THRESHOLDS).toEqual([10, 25, 50]);
    expect(HOUR_MILESTONE_THRESHOLDS).toEqual([100, 250, 500, 1000]);
  });
});

describe('crossedThreshold', () => {
  const T = EVENT_MILESTONE_THRESHOLDS;
  it.each([
    [9, 10, 10],
    [9, 26, 25],
    [0, 60, 50],
    [24, 25, 25],
    [49, 50, 50],
  ])('%i → %i crosses %i', (before, through, want) => {
    expect(crossedThreshold(before, through, T)).toBe(want);
  });

  it.each([
    [10, 11],
    [10, 10],
    [0, 9],
    [50, 70],
    [26, 49],
  ])('%i → %i crosses nothing', (before, through) => {
    expect(crossedThreshold(before, through, T)).toBeNull();
  });

  it('works on fractional hours', () => {
    expect(crossedThreshold(99.9, 100, HOUR_MILESTONE_THRESHOLDS)).toBe(100);
    expect(crossedThreshold(99.9, 99.99, HOUR_MILESTONE_THRESHOLDS)).toBeNull();
  });

  it('returns null for an empty threshold list', () => {
    expect(crossedThreshold(0, 1000, [])).toBeNull();
  });
});

describe('shapeNewMembers', () => {
  it('caps names but keeps the full total', () => {
    const rows = Array.from({ length: NEW_MEMBER_NAME_CAP + 3 }, (_, i) => ({
      user_id: i + 1,
      name: `M${i + 1}`,
    }));
    const out = shapeNewMembers(rows);
    expect(out.names).toHaveLength(NEW_MEMBER_NAME_CAP);
    expect(out.names[0]).toBe('M1');
    expect(out.total).toBe(NEW_MEMBER_NAME_CAP + 3);
  });

  it('drops rows with junk ids or blank names', () => {
    const out = shapeNewMembers([
      { user_id: null, name: 'Ghost' },
      { user_id: 2, name: '' },
      { user_id: '3', name: 'Mira' },
    ]);
    expect(out).toEqual({ names: ['Mira'], total: 1 });
  });
});

describe('shapeEventMilestones', () => {
  it('keeps only crossings, biggest first, bigint-as-text tolerated', () => {
    const out = shapeEventMilestones([
      { user_id: 1, name: 'Saffron', before_count: 9, through_count: 10 },
      { user_id: 2, name: 'Kael', before_count: '24', through_count: '26' },
      { user_id: 3, name: 'Idle', before_count: 10, through_count: 11 },
    ]);
    expect(out).toEqual([
      { userId: 2, name: 'Kael', threshold: 25 },
      { userId: 1, name: 'Saffron', threshold: 10 },
    ]);
  });

  it('caps the list', () => {
    const rows = Array.from({ length: MILESTONE_LIST_CAP + 2 }, (_, i) => ({
      user_id: i + 1,
      name: `U${i}`,
      before_count: 9,
      through_count: 10,
    }));
    expect(shapeEventMilestones(rows)).toHaveLength(MILESTONE_LIST_CAP);
  });
});

describe('shapeFirstGames / shapeHourMilestones', () => {
  it('shapes and caps first-time games', () => {
    const rows = Array.from({ length: MILESTONE_LIST_CAP + 1 }, (_, i) => ({
      game_id: i + 1,
      name: `G${i}`,
    }));
    const out = shapeFirstGames(rows);
    expect(out).toHaveLength(MILESTONE_LIST_CAP);
    expect(out[0]).toEqual({ gameId: 1, name: 'G0' });
  });

  it('converts seconds to hours and reports the highest crossing only', () => {
    const out = shapeHourMilestones([
      {
        game_id: 7,
        name: 'DRG',
        seconds_before: 240 * H,
        seconds_through: '1800000',
      },
      {
        game_id: 8,
        name: 'Flat',
        seconds_before: 120 * H,
        seconds_through: 200 * H,
      },
    ]);
    expect(out).toEqual([{ gameId: 7, name: 'DRG', threshold: 500 }]);
  });
});

describe('empty input', () => {
  it('every shaper returns empty for no rows', () => {
    expect(shapeNewMembers([])).toEqual({ names: [], total: 0 });
    expect(shapeEventMilestones([])).toEqual([]);
    expect(shapeFirstGames([])).toEqual([]);
    expect(shapeHourMilestones([])).toEqual([]);
  });

  it('isEmptyDigestMilestones is true only for an all-empty section', () => {
    const empty = emptyDigestMilestones();
    expect(isEmptyDigestMilestones(empty)).toBe(true);
    expect(
      isEmptyDigestMilestones({
        ...empty,
        firstGames: [{ gameId: 1, name: 'X' }],
      }),
    ).toBe(false);
  });
});

describe('query privacy (AC10)', () => {
  it.each([
    ['B1', buildNewMembersQuery()],
    ['B3', buildEventMilestonesQuery(10)],
    ['B2', buildFirstGamesQuery()],
    ['B4', buildHourMilestonesQuery(100 * H)],
  ])('%s carries the show_activity opt-out predicate', (_label, query) => {
    expect(render(query)).toContain("sa_pref.key = 'show_activity'");
  });

  it('B1 requires guild_member_seen_at and an active member', () => {
    const text = render(buildNewMembersQuery());
    expect(text).toContain('u.guild_member_seen_at IS NOT NULL');
    expect(text).toContain('u.deactivated_at IS NULL');
    expect(text).toContain('u.kicked_at IS NULL');
  });
});
