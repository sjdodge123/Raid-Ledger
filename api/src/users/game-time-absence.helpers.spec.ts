/**
 * Unit tests for absence-list helpers (ROK-1427).
 *
 * The inclusive `end_date` boundary and the timezone-local "today" resolution
 * are the whole bug — they get deterministic coverage here with an injected
 * clock, while the DB-backed filtering is covered in game-time.integration.spec.
 */
import { resolveLocalToday } from './game-time-absence.helpers';

describe('game-time-absence.helpers', () => {
  describe('Regression: ROK-1427 — resolveLocalToday', () => {
    it('returns the UTC date when the offset is 0', () => {
      const now = new Date('2026-08-20T12:00:00.000Z');

      expect(resolveLocalToday(0, now)).toBe('2026-08-20');
    });

    it('defaults to UTC when no offset is supplied', () => {
      const now = new Date('2026-08-20T12:00:00.000Z');

      expect(resolveLocalToday(undefined, now)).toBe('2026-08-20');
    });

    it('rolls back a day for western offsets before UTC midnight', () => {
      // 2026-08-20T03:00Z is still 2026-08-19 23:00 in New York (UTC-4).
      const now = new Date('2026-08-20T03:00:00.000Z');

      expect(resolveLocalToday(240, now)).toBe('2026-08-19');
    });

    it('rolls forward a day for eastern offsets after local midnight', () => {
      // 2026-08-20T23:00Z is already 2026-08-21 11:00 in Auckland (UTC+12).
      const now = new Date('2026-08-20T23:00:00.000Z');

      expect(resolveLocalToday(-720, now)).toBe('2026-08-21');
    });

    it('keeps the same day when the offset does not cross midnight', () => {
      const now = new Date('2026-08-20T18:00:00.000Z');

      expect(resolveLocalToday(240, now)).toBe('2026-08-20');
      expect(resolveLocalToday(-120, now)).toBe('2026-08-20');
    });

    it('handles month and year rollover in both directions', () => {
      expect(resolveLocalToday(600, new Date('2026-01-01T05:00:00.000Z'))).toBe(
        '2025-12-31',
      );
      expect(
        resolveLocalToday(-780, new Date('2025-12-31T13:00:00.000Z')),
      ).toBe('2026-01-01');
    });
  });
});
