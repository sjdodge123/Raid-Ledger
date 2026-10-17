/**
 * ROK-1732 — pure CORS decisions (no Express, no Nest, no I/O).
 *
 * `CORS_ORIGIN=auto` = SAME-ORIGIN ONLY: allow when there is no `Origin`, or
 * when the Origin's hostname equals the request's `Host` hostname. Ports are
 * not compared (nginx strips them, `monolith.conf.template:74`). Callers must
 * pass the raw `Host` header — never `req.hostname` / X-Forwarded-Host.
 */
import { CSP_REPORT_ROUTE } from '../csp-report/csp-report.constants';

export type CorsAutoMode = 'report' | 'enforce';

/**
 * Unset/blank `CORS_AUTO_MODE`. Flipped report → enforce after AC0 (prod logs
 * 2026-10-06..09: Host survives the proxy). Rollback: CORS_AUTO_MODE=report.
 */
export const DEFAULT_CORS_AUTO_MODE: CorsAutoMode = 'enforce';

/** Path Node sees for CSP reports (nginx strips the `/api` prefix). */
export const CSP_REPORT_PATH = `/${CSP_REPORT_ROUTE}`;

export const DEV_LOCALHOST_ORIGINS: readonly string[] = [
  'http://localhost',
  'http://localhost:80',
  'http://localhost:5173',
  'http://localhost:5174',
];

export type CorsDecisionReason =
  | 'no-origin'
  | 'same-host'
  | 'dev-localhost'
  | 'host-mismatch'
  | 'bad-origin'
  | 'no-host'
  | 'explicit-match'
  | 'explicit-mismatch';

export interface CorsDecision {
  allow: boolean;
  reason: CorsDecisionReason;
}

/**
 * Unset/blank → the default. Unknown → warn and fail OPEN to `report`, never
 * to `enforce`: a typo must not lock self-hosters out of login (#104, Q6).
 */
export function parseCorsAutoMode(
  raw: string | undefined,
  warn: (message: string) => void = () => undefined,
): CorsAutoMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return DEFAULT_CORS_AUTO_MODE;
  if (value === 'report' || value === 'enforce') return value;
  warn(
    `CORS_AUTO_MODE="${value.replace(/[^\x21-\x7e]/g, '').slice(0, 40)}" ` +
      'is not valid (use "report" or "enforce"); falling back to "report".',
  );
  return 'report';
}

/**
 * True only for `POST /csp-report` (exact path). Browsers send CSP reports
 * with `Origin: null` by spec (Reporting API / report-uri), so the same-origin
 * check would reject every one (AC0: the only would-rejects in prod). Safe to
 * exempt: the endpoint reads no cookies/JWT, has no guard, and only logs the
 * body; the policy also withholds any CORS grant for it.
 */
export function isCspReportRequest(method: string, path: string): boolean {
  return method === 'POST' && path === CSP_REPORT_PATH;
}

/** Lower-cased hostname of an http(s) Origin; null for `null`/garbage. */
export function originHostname(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** `Host` header without its port; keeps IPv6 brackets like URL.hostname. */
export function hostHeaderHostname(host: string | undefined): string | null {
  const value = host?.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(0, end + 1) : null;
  }
  return value.split(':')[0] || null;
}

/**
 * Same-origin decision for `CORS_ORIGIN=auto`. Dev localhost is checked before
 * the Host requirement so non-prod localhost decisions are unchanged (AC4).
 */
export function decideAutoOrigin(input: {
  origin?: string;
  hostHeader?: string;
  isProduction: boolean;
}): CorsDecision {
  if (!input.origin) return { allow: true, reason: 'no-origin' };
  const originHost = originHostname(input.origin);
  if (!originHost) return { allow: false, reason: 'bad-origin' };
  const host = hostHeaderHostname(input.hostHeader);
  if (host && host === originHost) return { allow: true, reason: 'same-host' };
  if (!input.isProduction && DEV_LOCALHOST_ORIGINS.includes(input.origin)) {
    return { allow: true, reason: 'dev-localhost' };
  }
  return { allow: false, reason: host ? 'host-mismatch' : 'no-host' };
}

/** Explicit `CORS_ORIGIN` (Render, dev): the pre-ROK-1732 allow list. */
export function decideExplicitOrigin(input: {
  origin?: string;
  corsOrigin?: string;
  isProduction: boolean;
}): CorsDecision {
  if (!input.origin) return { allow: true, reason: 'no-origin' };
  const allowed = [input.corsOrigin].filter(Boolean) as string[];
  if (!input.isProduction) allowed.push(...DEV_LOCALHOST_ORIGINS);
  const allow = input.corsOrigin === '*' || allowed.includes(input.origin);
  return { allow, reason: allow ? 'explicit-match' : 'explicit-mismatch' };
}
