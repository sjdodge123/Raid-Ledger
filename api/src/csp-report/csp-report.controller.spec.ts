/**
 * ROK-1501 — the csp-report controller keeps Cloudflare RUM beacon reports out
 * of Sentry (they exhausted the org error quota) but still logs them, and
 * captures every other report exactly as before.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CspReportController } from './csp-report.controller';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

const captureMessage = Sentry.captureMessage as jest.Mock;

const legacy = (blockedUri: string): unknown => ({
  'csp-report': {
    'document-uri': 'https://slot-3.gamernight.net/events',
    'blocked-uri': blockedUri,
    'effective-directive': 'script-src-elem',
  },
});

const reportingApi = (blockedURL: string): unknown => [
  {
    type: 'csp-violation',
    body: { blockedURL, effectiveDirective: 'img-src' },
  },
];

const BEACON_REPORTS: [string, unknown][] = [
  [
    'legacy beacon',
    legacy('https://static.cloudflareinsights.com/beacon.min.js/v31edd'),
  ],
  [
    'Reporting API rum connect',
    reportingApi('https://cloudflareinsights.com/cdn-cgi/rum'),
  ],
];

const CAPTURED_REPORTS: [string, unknown][] = [
  [
    'legacy jtvnw img-src',
    legacy('https://static-cdn.jtvnw.net/previews-ttv/x.jpg'),
  ],
  [
    'Reporting API jtvnw img-src',
    reportingApi('https://static-cdn.jtvnw.net/previews-ttv/x.jpg'),
  ],
  ['legacy eval', legacy('eval')],
  ['legacy inline', legacy('inline')],
  ['empty object body', {}],
  ['missing body', undefined],
];

let controller: CspReportController;
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  captureMessage.mockReset();
  logSpy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  controller = new CspReportController();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CspReportController.handle (ROK-1501)', () => {
  it.each(BEACON_REPORTS)(
    '%s is logged but not sent to Sentry',
    (_label, report) => {
      controller.handle(report);

      expect(captureMessage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith({
        event: 'csp_violation',
        report,
        ignored: 'cloudflare_beacon',
      });
    },
  );

  it.each(CAPTURED_REPORTS)(
    '%s is captured and logged as before',
    (_label, report) => {
      controller.handle(report);

      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(captureMessage).toHaveBeenCalledWith('CSP violation', {
        level: 'warning',
        tags: { source: 'csp_report' },
        extra: { report },
      });
      expect(logSpy).toHaveBeenCalledWith({ event: 'csp_violation', report });
    },
  );

  it('still logs the report when Sentry.captureMessage throws', () => {
    captureMessage.mockImplementation(() => {
      throw new Error('sentry down');
    });
    const report = legacy('eval');

    expect(() => controller.handle(report)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      'Sentry.captureMessage failed for CSP report: sentry down',
    );
    expect(logSpy).toHaveBeenCalledWith({ event: 'csp_violation', report });
  });
});
