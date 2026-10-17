import type { Logger } from '@nestjs/common';

/** The `.message` of a thrown Error, or the stringified thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Trailing argument for Nest `logger.error/warn(message, stack)`: the stack
 * of a thrown Error (its first line already repeats the message), or the
 * stringified value when something else was thrown. On a context-bearing
 * Logger it prints as an extra line under the message.
 */
export function errorStack(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.stack ?? error.message;
}

/**
 * `.catch` handler for a best-effort side effect: warns `message` and keeps
 * the failure's stack, so a swallowed rejection is still traceable.
 */
export function warnWithStack(
  logger: Pick<Logger, 'warn'>,
  message: string,
): (error: unknown) => void {
  return (error) => logger.warn(message, errorStack(error));
}
