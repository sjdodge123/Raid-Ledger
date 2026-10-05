/**
 * ROK-1732 — report-only evidence for `CORS_ORIGIN=auto`.
 *
 * Emits two kinds of `[cors-auto]` lines (spec D3):
 * - `would-reject` (warn, report mode only): an Origin that the same-origin
 *   check would refuse, rate-limited per `reason|originHost|hostHeader`.
 * - `host-check ok` (log, both modes): once per distinct Origin/Host pair per
 *   boot, positively recording what `Host` the API sees behind the proxy.
 *
 * Privacy (AC6): only the fields below are ever logged. Never the client IP,
 * X-Forwarded-For, cookies, Authorization, User-Agent, Referer, query string
 * or body. Every value is stripped to printable non-space ASCII and length
 * capped, so a header cannot forge extra `key=value` fields.
 */

export interface CorsReportLogger {
  warn(message: string): void;
  log(message: string): void;
}

/** Request facts a reporter needs. `path` must not carry a query string. */
export interface CorsReportInput {
  reason: string;
  origin?: string;
  host?: string;
  xfh?: string;
  sfs?: string;
  method?: string;
  path?: string;
  /** Trusted `process.env.CLIENT_URL` (ROK-1627) — evidence only. */
  clientUrl?: string;
}

export interface CorsReporter {
  wouldReject(input: CorsReportInput): void;
  hostCheck(input: CorsReportInput): void;
}

export const REPORT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REPORT_KEYS = 200;
export const MAX_HOST_CHECK_PAIRS = 20;
const OVERFLOW_LINE = '[cors-auto] would-reject overflow suppressed=';

/** Printable ASCII minus space, capped; `-` when absent or empty. */
export function sanitizeField(value: string | undefined, max = 120): string {
  if (!value) return '-';
  const cleaned = value.replace(/[^\x21-\x7e]/g, '').slice(0, max);
  return cleaned || '-';
}

/** `scheme://host[:port]` of a URL, or null when unparseable / opaque. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Origin reduced to scheme://host[:port] (drops any userinfo/path). */
export function sanitizeOrigin(origin: string | undefined): string {
  return sanitizeField(originOf(origin) ?? origin);
}

/** Path without any query string or fragment, even if the caller passed one. */
export function sanitizePath(path: string | undefined): string {
  return sanitizeField(path?.split(/[?#]/)[0]);
}

/** `yes` / `no` / `unset` — does the Origin equal the trusted CLIENT_URL's? */
export function clientUrlMatch(
  origin: string | undefined,
  clientUrl: string | undefined,
): 'yes' | 'no' | 'unset' {
  const trusted = originOf(clientUrl);
  if (!trusted) return 'unset';
  return originOf(origin) === trusted ? 'yes' : 'no';
}

function pairFields(input: CorsReportInput): string {
  return (
    `origin=${sanitizeOrigin(input.origin)} host=${sanitizeField(input.host)} ` +
    `xfh=${sanitizeField(input.xfh)} sfs=${sanitizeField(input.sfs, 20)}`
  );
}

export function formatWouldReject(
  input: CorsReportInput,
  suppressed: number,
): string {
  return (
    `[cors-auto] would-reject reason=${sanitizeField(input.reason, 20)} ` +
    `${pairFields(input)} method=${sanitizeField(input.method, 10)} ` +
    `path=${sanitizePath(input.path)} ` +
    `client_url_match=${clientUrlMatch(input.origin, input.clientUrl)} ` +
    `suppressed=${suppressed}`
  );
}

export function formatHostCheck(input: CorsReportInput): string {
  return `[cors-auto] host-check ok ${pairFields(input)}`;
}

interface Throttle {
  lastAt: number;
  suppressed: number;
}

/** Returns the suppressed count to emit with, or null to stay silent. */
function throttle(state: Throttle, now: number): number | null {
  if (now - state.lastAt < REPORT_WINDOW_MS) {
    state.suppressed += 1;
    return null;
  }
  const suppressed = state.suppressed;
  state.lastAt = now;
  state.suppressed = 0;
  return suppressed;
}

function reportKey(input: CorsReportInput): string {
  return [input.reason, sanitizeOrigin(input.origin), sanitizeField(input.host)]
    .join('|')
    .toLowerCase();
}

/** Builds a reporter with module-free state; `now` is injectable for tests. */
export function createCorsReporter(
  logger: CorsReportLogger,
  now: () => number = Date.now,
): CorsReporter {
  const keys = new Map<string, Throttle>();
  const overflow: Throttle = { lastAt: -Infinity, suppressed: 0 };
  const pairs = new Set<string>();
  const wouldReject = (input: CorsReportInput): void => {
    const key = reportKey(input);
    const state = keys.get(key);
    if (state) {
      const suppressed = throttle(state, now());
      if (suppressed !== null)
        logger.warn(formatWouldReject(input, suppressed));
    } else if (keys.size < MAX_REPORT_KEYS) {
      keys.set(key, { lastAt: now(), suppressed: 0 });
      logger.warn(formatWouldReject(input, 0));
    } else {
      // Keys past the cap share one counter, emitted at most once a window.
      const dropped = throttle(overflow, now());
      if (dropped !== null) logger.warn(`${OVERFLOW_LINE}${dropped + 1}`);
    }
  };
  const hostCheck = (input: CorsReportInput): void => {
    const pair = `${sanitizeOrigin(input.origin)}|${sanitizeField(input.host)}`;
    if (pairs.has(pair) || pairs.size >= MAX_HOST_CHECK_PAIRS) return;
    pairs.add(pair);
    logger.log(formatHostCheck(input));
  };
  return { wouldReject, hostCheck };
}
