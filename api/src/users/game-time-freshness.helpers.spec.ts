/**
 * ROK-1560 — shared game-time freshness helpers.
 *
 * Pre-change these fail with "Cannot find module './game-time-freshness.helpers'":
 * the staleness rule lived only as a private method on GameTimeService, so the
 * scheduling-poll heatmap had no way to reuse the product's one definition of stale.
 */
import {
  GAME_TIME_FRESHNESS_DAYS,
  isGameTimeStale,
  gameTimeAgeDays,
} from './game-time-freshness.helpers';

describe('game-time freshness helpers', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');

  function daysAgo(days: number): Date {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  }

  it('treats a never-confirmed template as stale', () => {
    expect(isGameTimeStale(null, now)).toBe(true);
  });

  it('treats confirmation older than the freshness window as stale', () => {
    expect(isGameTimeStale(daysAgo(8), now)).toBe(true);
  });

  it('treats confirmation inside the window (incl. exactly 7 days) as fresh', () => {
    expect(isGameTimeStale(daysAgo(0), now)).toBe(false);
    expect(isGameTimeStale(daysAgo(GAME_TIME_FRESHNESS_DAYS), now)).toBe(false);
  });

  it('reports whole-day age, null when never confirmed', () => {
    expect(gameTimeAgeDays(null, now)).toBeNull();
    expect(gameTimeAgeDays(daysAgo(0), now)).toBe(0);
    expect(gameTimeAgeDays(daysAgo(30), now)).toBe(30);
  });
});
