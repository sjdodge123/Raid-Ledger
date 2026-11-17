/**
 * ROK-1143 / ROK-2249 / ROK-2250: some 503s are thrown on purpose — the
 * endpoint is answering correctly that a dependency isn't ready yet (no
 * community-insights snapshot before the daily cron, no Blizzard API keys on
 * this instance). They are not bugs, so `beforeSend` drops them.
 *
 * Match on the exception's RESPONSE BODY `error` code, never on the Sentry
 * event value: Nest builds `HttpException({ error: 'no_snapshot_yet' }, 503)`
 * with the message "Http Exception", so the code never appears in the value
 * (that is why the ROK-1143 value-string drop never fired).
 *
 * Duck-typed (no `instanceof HttpException`) because this runs inside
 * instrument.ts, loaded before Nest — a second copy of `@nestjs/common`
 * (jest module resets, bundling) would make `instanceof` silently false.
 */

/** Response-body `error` codes of 503s that are thrown on purpose. */
export const INTENTIONAL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'no_snapshot_yet',
  'blizzard_not_configured',
]);

const SERVICE_UNAVAILABLE = 503;

/** Calls a zero-arg method on `target` when it exists; undefined otherwise. */
function callMethod(target: object, name: string): unknown {
  const fn: unknown = Reflect.get(target, name);
  if (typeof fn !== 'function') return undefined;
  const result: unknown = fn.call(target);
  return result;
}

/**
 * True when `exception` is an HttpException-shaped 503 whose response body
 * carries one of INTENTIONAL_UNAVAILABLE_CODES as its `error`.
 */
export function isIntentionalUnavailable(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  if (callMethod(exception, 'getStatus') !== SERVICE_UNAVAILABLE) return false;
  const body = callMethod(exception, 'getResponse');
  if (typeof body !== 'object' || body === null) return false;
  const code: unknown = Reflect.get(body, 'error');
  return typeof code === 'string' && INTENTIONAL_UNAVAILABLE_CODES.has(code);
}
