import { z } from 'zod';

/**
 * Event report link (ROK-1725): an organiser pastes a combat-log report URL
 * (Warcraft Logs or foreverlogs.gg) on an event. Allow-listed on write and
 * never fetched server-side. `PATCH /events/:id/report-link`.
 */

/** Longest report URL accepted (stored in `events.report_url`). */
export const EVENT_REPORT_URL_MAX = 500;

/** Log sites whose report links are accepted (subdomains included). */
export const EVENT_REPORT_HOSTS = ['warcraftlogs.com', 'foreverlogs.gg'] as const;

/** `true` when `hostname` is an allow-listed log site or one of its subdomains. */
export function isAllowedReportHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return EVENT_REPORT_HOSTS.some((base) => h === base || h.endsWith(`.${base}`));
}

/**
 * Why a report URL is unacceptable, or `null` when it is fine. Returns the
 * first failing rule: https only, no `user:pass@`, no explicit port, an
 * allow-listed host, and a path beyond the site's home page.
 */
export function eventReportUrlProblem(raw: string): string | null {
  if (raw.length > EVENT_REPORT_URL_MAX) return 'Report link is too long';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Paste the full report link, e.g. https://www.warcraftlogs.com/reports/…';
  }
  if (url.protocol !== 'https:') return 'Report link must start with https://';
  if (url.username !== '' || url.password !== '') {
    return 'Report link must not contain a username or password';
  }
  if (url.port !== '') return 'Report link must not include a port';
  if (!isAllowedReportHost(url.hostname)) {
    return 'Only Warcraft Logs and foreverlogs.gg report links are accepted';
  }
  if (url.pathname === '/') {
    return "Paste a link to a specific report, not the site's home page";
  }
  // Normalising percent-encodes non-ASCII, so the stored form can be longer than the input.
  if (url.href.length > EVENT_REPORT_URL_MAX) return 'Report link is too long';
  return null;
}

/** Canonical form of an accepted report URL. Call only after `eventReportUrlProblem` returned null. */
export function normalizeEventReportUrl(raw: string): string {
  return new URL(raw.trim()).href;
}

/** A trimmed, validated, normalised report URL. */
export const EventReportUrlSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = eventReportUrlProblem(value);
    if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
  })
  .transform(normalizeEventReportUrl);

/** Display name of the log site a stored report URL points at. */
export function reportLinkSiteName(url: string): 'Warcraft Logs' | 'foreverlogs.gg' | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (hostname === 'warcraftlogs.com' || hostname.endsWith('.warcraftlogs.com')) {
    return 'Warcraft Logs';
  }
  if (hostname === 'foreverlogs.gg' || hostname.endsWith('.foreverlogs.gg')) {
    return 'foreverlogs.gg';
  }
  return null;
}

/** Body of `PATCH /events/:id/report-link`; `null` clears the link. */
export const UpdateEventReportLinkSchema = z
  .object({ reportUrl: EventReportUrlSchema.nullable() })
  .strict();
export type UpdateEventReportLinkDto = z.infer<typeof UpdateEventReportLinkSchema>;
