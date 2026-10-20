import { ConflictException } from '@nestjs/common';

/** ROK-1870 review — map a unique-index clash to a 409 instead of a 500. */

/** PG SQLSTATE 23505 on the error or its `cause` (drizzle wraps postgres.js). */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && err.code === '23505') return true;
  return 'cause' in err && isUniqueViolation(err.cause);
}

/** Run `fn`; a unique violation becomes `409 message`, anything else rethrows. */
export async function conflictOnUnique<T>(
  fn: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw new ConflictException(message);
    throw err;
  }
}
