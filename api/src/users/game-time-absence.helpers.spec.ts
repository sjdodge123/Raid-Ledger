/**
 * Unit tests for absence-list helpers (ROK-1427).
 *
 * The inclusive `end_date` boundary and the timezone-local "today" resolution
 * are the whole bug — they get deterministic coverage here with an injected
 * clock, while the DB-backed filtering is covered in game-time.integration.spec.
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import {
  fetchAbsencesEndingOnOrAfter,
  resolveLocalToday,
} from './game-time-absence.helpers';

/** A PG error as Drizzle throws it: wrapped, with the SQLSTATE on `cause`. */
function drizzleError(code: string, message: string): DrizzleQueryError {
  const pgErr = Object.assign(new Error(message), { code });
  return new DrizzleQueryError(
    'select ... from "game_time_absences"',
    [],
    pgErr,
  );
}

/** A db whose absence-list query (terminating at `.where()`) rejects. */
function dbRejectingWith(err: unknown): PostgresJsDatabase<typeof schema> {
  const mockDb = createDrizzleMock();
  mockDb.where.mockRejectedValueOnce(err);
  return mockDb as unknown as PostgresJsDatabase<typeof schema>;
}

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

  describe('Regression: fetchAbsencesEndingOnOrAfter missing-table guard', () => {
    // The week-bounded fetchAbsences already swallowed 42P01; the absence-list
    // query did not, so a missing game_time_absences table 500'd the endpoint.
    it('returns [] when game_time_absences does not exist (42P01)', async () => {
      const err = drizzleError(
        '42P01',
        'relation "game_time_absences" does not exist',
      );

      await expect(
        fetchAbsencesEndingOnOrAfter(dbRejectingWith(err), 1, '2026-08-20'),
      ).resolves.toEqual([]);
    });

    it('rethrows any other database error', async () => {
      const err = drizzleError(
        '23505',
        'duplicate key value violates unique constraint',
      );

      await expect(
        fetchAbsencesEndingOnOrAfter(dbRejectingWith(err), 1, '2026-08-20'),
      ).rejects.toBe(err);
    });
  });
});
