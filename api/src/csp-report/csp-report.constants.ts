/**
 * Route segment of the CSP violation report endpoint. Shared by the
 * controller and the CORS policy's exemption (ROK-1732) so the two can never
 * drift apart. nginx's `report-uri /api/csp-report` strips `/api`, so Node
 * sees `/csp-report`.
 */
export const CSP_REPORT_ROUTE = 'csp-report';

// Browsers POST CSP violation reports with content-type `application/csp-report`
// (legacy) or `application/reports+json` (Reporting API). Nest's default
// `application/json` parser ignores both, so main.helpers registers a
// dedicated parser for them (ROK-1158). The controller sends only these two
// types to Sentry: anything else is not a browser CSP report.
export const CSP_REPORT_CONTENT_TYPES = [
  'application/csp-report',
  'application/reports+json',
];

/** True when the header's media type (parameters ignored) is a CSP report type. */
export function isCspReportContentType(header: string | undefined): boolean {
  const mediaType = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return CSP_REPORT_CONTENT_TYPES.includes(mediaType);
}
