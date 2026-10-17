import { DrizzleQueryError } from 'drizzle-orm/errors';
import { isUniqueViolation } from './guild-editors.helpers';

/** A postgres.js-shaped driver error carrying a SQLSTATE. */
function pgError(code: string): Error {
  return Object.assign(new Error('driver error'), { code });
}

describe('guild-editors isUniqueViolation', () => {
  it('recognises a 23505 wrapped by Drizzle on .cause (concurrent duplicate grant → 409)', () => {
    const wrapped = new DrizzleQueryError(
      'insert into "guild_editors" ...',
      [],
      pgError('23505'),
    );
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('recognises a bare driver 23505', () => {
    expect(isUniqueViolation(pgError('23505'))).toBe(true);
  });

  it('rejects a wrapped non-unique error', () => {
    const wrapped = new DrizzleQueryError('q', [], pgError('23503'));
    expect(isUniqueViolation(wrapped)).toBe(false);
  });
});
