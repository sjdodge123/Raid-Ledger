/**
 * Shared helpers for inspecting Postgres errors that surface through Drizzle.
 *
 * Drizzle wraps `postgres-js` errors so `err.message` becomes the generic
 * "Failed query: <SQL>" string and the real PG error (with code/detail/hint)
 * is in `err.cause`. Without unwrapping, masked failures like FK violations
 * or unique-constraint collisions look like opaque 500s in the logs.
 */

/** Shape of postgres.js error properties we want to extract. */
interface PgErrorLike {
  message?: string;
  code?: string;
  detail?: string;
  hint?: string;
  cause?: PgErrorLike;
}

/**
 * Extract Postgres error details from a Drizzle-wrapped error.
 * Drizzle wraps PG errors so `err.message` is "Failed query: <SQL>".
 * The real PG error is in `.cause` with code, detail, and hint.
 */
export function extractErrorDetail(err: unknown): string {
  const raw = err instanceof Error ? err : { message: String(err) };
  const pgError: PgErrorLike = (raw as PgErrorLike).cause ?? raw;
  return [
    pgError.message,
    pgError.code ? `code=${pgError.code}` : null,
    pgError.detail ? `detail=${pgError.detail}` : null,
    pgError.hint ? `hint=${pgError.hint}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}
