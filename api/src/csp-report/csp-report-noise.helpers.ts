/**
 * ROK-1501 — recognise CSP reports caused by Cloudflare's Real User Monitoring
 * beacon, so the csp-report controller can keep them out of Sentry.
 *
 * Cloudflare injects its RUM beacon (`static.cloudflareinsights.com/beacon.min.js`,
 * which then calls `cloudflareinsights.com/cdn-cgi/rum`) into every response on
 * a proxied host. The app's CSP does not allow that origin, so the browser
 * reports a violation on every page load — an artefact of the proxy, and
 * nothing the app can fix without weakening its own CSP. Before this filter
 * those reports were ~93% of the org's Sentry error events (the fleet
 * Playwright suite loads thousands of pages a day). The smoke suite already
 * treats the beacon as noise for the same reason (ROK-1466,
 * `scripts/smoke/console-filter.ts`).
 *
 * Matching is on the Cloudflare host ONLY, so every other CSP violation —
 * including an inline-script, eval or third-party-script report — is still
 * captured. Pure: no Nest or Sentry imports.
 */

const CLOUDFLARE_INSIGHTS_HOST = 'cloudflareinsights.com';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Legacy `application/csp-report`: `{ "csp-report": { "blocked-uri" } }`. */
function legacyBlockedUri(report: UnknownRecord): unknown {
  const inner = report['csp-report'];
  return isRecord(inner) ? inner['blocked-uri'] : undefined;
}

/** Reporting API `application/reports+json`: `{ type, body: { blockedURL } }`. */
function reportingApiBlockedUrl(report: UnknownRecord): unknown {
  if (report.type !== 'csp-violation' || !isRecord(report.body)) {
    return undefined;
  }
  return report.body.blockedURL;
}

/** True only for an absolute URL on cloudflareinsights.com or a subdomain. */
function isCloudflareInsightsUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri === '') return false;
  let hostname: string;
  try {
    hostname = new URL(uri).hostname;
  } catch {
    return false; // 'eval', 'inline', and other non-URL keywords
  }
  return (
    hostname === CLOUDFLARE_INSIGHTS_HOST ||
    hostname.endsWith(`.${CLOUDFLARE_INSIGHTS_HOST}`)
  );
}

function isBeaconReport(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return (
    isCloudflareInsightsUri(legacyBlockedUri(entry)) ||
    isCloudflareInsightsUri(reportingApiBlockedUrl(entry))
  );
}

/**
 * Whether a parsed CSP report body is Cloudflare RUM beacon noise.
 *
 * A Reporting API batch counts only when EVERY entry is a beacon report, so a
 * real violation that arrives in the same batch is never dropped.
 *
 * @param report - The parsed request body (any shape; malformed is false).
 */
export function isCloudflareBeaconCspReport(report: unknown): boolean {
  if (Array.isArray(report)) {
    return report.length > 0 && report.every(isBeaconReport);
  }
  return isBeaconReport(report);
}
