/**
 * Backlog 2026-10-18 (csp-report.controller.ts:21): the public CSP endpoint's
 * process-wide Sentry budget and log truncation.
 */
import {
  CSP_LOG_MAX_CHARS,
  CspSentryBudget,
  logSafeReport,
} from './csp-report-guard';

describe('CspSentryBudget', () => {
  it('allows `limit` captures per window, then refuses until the window rolls', () => {
    let t = 1_000;
    const budget = new CspSentryBudget(2, 60_000, () => t);

    expect([
      budget.tryConsume(),
      budget.tryConsume(),
      budget.tryConsume(),
    ]).toEqual([true, true, false]);
    t += 59_999;
    expect(budget.tryConsume()).toBe(false);
    t += 1;
    expect(budget.tryConsume()).toBe(true);
  });
});

describe('logSafeReport', () => {
  it('keeps a small report as-is', () => {
    const report = { 'csp-report': { 'blocked-uri': 'eval' } };

    expect(logSafeReport(report)).toEqual({ report });
  });

  it('truncates an oversized report to CSP_LOG_MAX_CHARS characters of JSON', () => {
    const report = { blob: 'x'.repeat(CSP_LOG_MAX_CHARS * 2) };
    const out = logSafeReport(report);

    expect(out).toEqual({
      reportTruncated: JSON.stringify(report).slice(0, CSP_LOG_MAX_CHARS),
    });
  });

  it('does not throw on a circular value', () => {
    const report: { self?: unknown } = {};
    report.self = report;

    expect(logSafeReport(report)).toEqual({
      reportTruncated: '[unserialisable report]',
    });
  });
});
