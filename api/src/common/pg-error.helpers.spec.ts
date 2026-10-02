import { DrizzleQueryError } from 'drizzle-orm/errors';
import { isMissingTableError, pgErrorCode } from './pg-error.helpers';

/** A postgres-js error: the SQLSTATE sits on the error itself. */
function rawPgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

/** The same error as Drizzle rethrows it: wrapped, SQLSTATE on `cause`. */
function wrapped(code: string): DrizzleQueryError {
  return new DrizzleQueryError('select 1', [], rawPgError(code));
}

describe('pgErrorCode', () => {
  it('reads the code off a raw postgres-js error', () => {
    expect(pgErrorCode(rawPgError('23505'))).toBe('23505');
  });

  it("reads the code off a DrizzleQueryError's cause", () => {
    expect(pgErrorCode(wrapped('42P01'))).toBe('42P01');
  });

  it('returns undefined when no SQLSTATE is present', () => {
    expect(pgErrorCode(new Error('boom'))).toBeUndefined();
    expect(pgErrorCode('42P01')).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });
});

describe('isMissingTableError', () => {
  it('matches a Drizzle-wrapped 42P01 (the shape real queries throw)', () => {
    expect(isMissingTableError(wrapped('42P01'))).toBe(true);
  });

  it('matches a raw 42P01', () => {
    expect(isMissingTableError(rawPgError('42P01'))).toBe(true);
  });

  it('rejects other SQLSTATEs, raw or wrapped', () => {
    expect(isMissingTableError(wrapped('23505'))).toBe(false);
    expect(isMissingTableError(rawPgError('23503'))).toBe(false);
  });
});
