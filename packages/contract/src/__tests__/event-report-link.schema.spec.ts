import { describe, expect, it } from 'vitest';
import {
  EVENT_REPORT_URL_MAX,
  UpdateEventReportLinkSchema,
  eventReportUrlProblem,
  reportLinkSiteName,
} from '../event-report-link.schema.js';

const HOST = 'Only Warcraft Logs and foreverlogs.gg report links are accepted';

describe('eventReportUrlProblem (ROK-1725)', () => {
  it.each([
    'https://www.warcraftlogs.com/reports/AbC123',
    'https://classic.warcraftlogs.com/reports/x',
    'https://fresh.warcraftlogs.com/reports/x',
    'https://sod.warcraftlogs.com/reports/x',
    'https://warcraftlogs.com/reports/x',
    'https://foreverlogs.gg/reports/1',
    'https://www.foreverlogs.gg/reports/1',
  ])('accepts %s', (url) => {
    expect(eventReportUrlProblem(url)).toBeNull();
  });

  it.each([
    ['', 'Paste the full report link, e.g. https://www.warcraftlogs.com/reports/…'],
    ['javascript:alert(1)', 'Report link must start with https://'],
    ['data:text/html,<b>x</b>', 'Report link must start with https://'],
    ['http://www.warcraftlogs.com/reports/x', 'Report link must start with https://'],
    ['https://u:p@www.warcraftlogs.com/reports/x', 'Report link must not contain a username or password'],
    ['https://www.warcraftlogs.com:8443/reports/x', 'Report link must not include a port'],
    ['https://warcraftlogs.com.evil.com/reports/x', HOST],
    ['https://foreverlogs.gg.evil.io/r/1', HOST],
    ['https://notwarcraftlogs.com/reports/x', HOST],
    ['https://93.184.216.34/reports/x', HOST],
    ['https://www.warcraftlogs.com/', "Paste a link to a specific report, not the site's home page"],
  ])('rejects %s', (url, message) => {
    expect(eventReportUrlProblem(url)).toBe(message);
  });

  it('rejects input longer than the limit', () => {
    const url = `https://www.warcraftlogs.com/reports/${'a'.repeat(EVENT_REPORT_URL_MAX)}`;
    expect(eventReportUrlProblem(url)).toBe('Report link is too long');
  });

  it('measures the normalised form, which percent-encodes non-ASCII', () => {
    const url = `https://www.warcraftlogs.com/reports/${'é'.repeat(200)}`;
    expect(url.length).toBeLessThan(EVENT_REPORT_URL_MAX);
    expect(eventReportUrlProblem(url)).toBe('Report link is too long');
  });
});

describe('UpdateEventReportLinkSchema', () => {
  it('trims and normalises an accepted URL', () => {
    expect(
      UpdateEventReportLinkSchema.parse({ reportUrl: '  https://WWW.WarcraftLogs.com/reports/AbC  ' }),
    ).toEqual({ reportUrl: 'https://www.warcraftlogs.com/reports/AbC' });
  });

  it('accepts null to clear the link', () => {
    expect(UpdateEventReportLinkSchema.parse({ reportUrl: null })).toEqual({ reportUrl: null });
  });

  it('rejects unknown keys', () => {
    expect(UpdateEventReportLinkSchema.safeParse({ reportUrl: null, extra: 1 }).success).toBe(false);
  });
});

describe('reportLinkSiteName', () => {
  it.each([
    ['https://classic.warcraftlogs.com/reports/x', 'Warcraft Logs'],
    ['https://www.foreverlogs.gg/r/1', 'foreverlogs.gg'],
    ['https://example.com/r', null],
    ['not a url', null],
  ])('%s → %s', (url, name) => {
    expect(reportLinkSiteName(url)).toBe(name);
  });
});
