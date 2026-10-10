/**
 * ROK-1732 T1 — the same-origin decision table for `CORS_ORIGIN=auto`, the
 * explicit-origin allow list (AC4), and `CORS_AUTO_MODE` parsing (Q6).
 */
import {
  CSP_REPORT_PATH,
  DEFAULT_CORS_AUTO_MODE,
  isCspReportRequest,
  decideAutoOrigin,
  decideExplicitOrigin,
  hostHeaderHostname,
  originHostname,
  parseCorsAutoMode,
} from './cors-auto-decision';

const PROD = 'raid.gamernight.net';

function auto(
  origin: string | undefined,
  hostHeader?: string,
  isProduction = true,
) {
  return decideAutoOrigin({ origin, hostHeader, isProduction });
}

describe('decideAutoOrigin — allows', () => {
  it('a request with no Origin (same-origin GET, curl, server-to-server)', () => {
    expect(auto(undefined, PROD)).toEqual({ allow: true, reason: 'no-origin' });
    expect(auto('', PROD)).toEqual({ allow: true, reason: 'no-origin' });
  });

  it('an Origin whose hostname equals the Host header', () => {
    expect(auto(`https://${PROD}`, PROD)).toEqual({
      allow: true,
      reason: 'same-host',
    });
  });

  it('ignores the Host port (nginx strips it) and the Origin port', () => {
    expect(auto(`https://${PROD}`, `${PROD}:443`).reason).toBe('same-host');
    expect(auto(`http://${PROD}:8080`, PROD).reason).toBe('same-host');
  });

  it('compares hostnames case-insensitively', () => {
    expect(
      auto('https://RAID.GamerNight.net', 'Raid.GAMERNIGHT.net').allow,
    ).toBe(true);
  });

  it('matches bracketed IPv6 hosts with and without a port', () => {
    expect(auto('http://[::1]:5173', '[::1]:3000').reason).toBe('same-host');
    expect(auto('http://[::1]', '[::1]').reason).toBe('same-host');
  });
});

describe('decideAutoOrigin — rejects', () => {
  it('a sibling subdomain (the ROK-973 cookie-replay path)', () => {
    expect(auto('https://slot-1.gamernight.net', PROD)).toEqual({
      allow: false,
      reason: 'host-mismatch',
    });
  });

  it('a suffix-extended look-alike host', () => {
    expect(auto(`https://${PROD}.evil.example`, PROD).reason).toBe(
      'host-mismatch',
    );
    expect(auto('https://evil.example', `${PROD}.evil.example`).allow).toBe(
      false,
    );
  });

  it('the opaque `null` Origin and unparseable / non-http Origins', () => {
    for (const origin of [
      'null',
      'not a url',
      'file:///etc/passwd',
      'chrome-extension://abc',
    ]) {
      expect({ origin, decision: auto(origin, PROD) }).toEqual({
        origin,
        decision: { allow: false, reason: 'bad-origin' },
      });
    }
  });

  it('a missing or empty Host header', () => {
    expect(auto(`https://${PROD}`, undefined)).toEqual({
      allow: false,
      reason: 'no-host',
    });
    expect(auto(`https://${PROD}`, '  ').reason).toBe('no-host');
  });
});

describe('decideAutoOrigin — dev localhost list (AC4)', () => {
  const localhosts = [
    'http://localhost',
    'http://localhost:80',
    'http://localhost:5173',
    'http://localhost:5174',
  ];

  it('non-production allows the localhost list against any Host, even none', () => {
    for (const origin of localhosts) {
      expect(auto(origin, 'api:3000', false)).toEqual({
        allow: true,
        reason: 'dev-localhost',
      });
      expect(auto(origin, undefined, false).allow).toBe(true);
    }
  });

  it('production does not', () => {
    for (const origin of localhosts) {
      expect(auto(origin, PROD, true).reason).toBe('host-mismatch');
    }
  });

  it('non-production still rejects other cross-host origins', () => {
    expect(auto('https://evil.example', 'localhost:3000', false).reason).toBe(
      'host-mismatch',
    );
  });
});

describe('hostname helpers', () => {
  it('originHostname lower-cases and refuses non-http schemes', () => {
    expect(originHostname('HTTPS://Raid.Example:8443')).toBe('raid.example');
    expect(originHostname('ftp://raid.example')).toBeNull();
    expect(originHostname('null')).toBeNull();
  });

  it('hostHeaderHostname strips ports and keeps IPv6 brackets', () => {
    expect(hostHeaderHostname('Raid.Example:443')).toBe('raid.example');
    expect(hostHeaderHostname('[::1]:80')).toBe('[::1]');
    expect(hostHeaderHostname('[::1')).toBeNull();
    expect(hostHeaderHostname(':80')).toBeNull();
    expect(hostHeaderHostname(undefined)).toBeNull();
  });
});

describe('decideExplicitOrigin (unchanged allow list, AC4)', () => {
  const explicit = (
    origin: string | undefined,
    corsOrigin: string | undefined,
    isProduction = true,
  ) => decideExplicitOrigin({ origin, corsOrigin, isProduction }).allow;

  it('allows no Origin, the configured origin and `*`', () => {
    expect(explicit(undefined, 'https://app.com')).toBe(true);
    expect(explicit('https://app.com', 'https://app.com')).toBe(true);
    expect(explicit('https://anything.example', '*')).toBe(true);
  });

  it('rejects other origins, and localhost in production', () => {
    expect(explicit('https://evil.com', 'https://app.com')).toBe(false);
    expect(explicit('http://localhost:5173', 'https://app.com')).toBe(false);
  });

  it('allows the localhost list in development, even with no CORS_ORIGIN', () => {
    expect(explicit('http://localhost:5173', 'https://app.com', false)).toBe(
      true,
    );
    expect(explicit('http://localhost:5174', undefined, false)).toBe(true);
    expect(explicit('http://localhost:3000', undefined, false)).toBe(false);
  });
});

describe('parseCorsAutoMode', () => {
  it('defaults to enforce (unset or blank) after AC0', () => {
    expect(DEFAULT_CORS_AUTO_MODE).toBe('enforce');
    expect(parseCorsAutoMode(undefined)).toBe('enforce');
    expect(parseCorsAutoMode('   ')).toBe('enforce');
  });

  it('accepts report / enforce case-insensitively without warning', () => {
    const warn = jest.fn();
    expect(parseCorsAutoMode('enforce', warn)).toBe('enforce');
    expect(parseCorsAutoMode(' ENFORCE ', warn)).toBe('enforce');
    expect(parseCorsAutoMode('Report', warn)).toBe('report');
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails OPEN to report on a typo, warning with the variable name (Q6)', () => {
    const warn = jest.fn();
    expect(parseCorsAutoMode('enforced', warn)).toBe('report');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'CORS_AUTO_MODE="enforced" is not valid',
    );
    expect(warn.mock.calls[0][0]).toContain('falling back to "report"');
  });
});

describe('isCspReportRequest (ROK-1732 enforce: Origin: null exemption)', () => {
  it('matches only POST to the exact CSP report path', () => {
    expect(CSP_REPORT_PATH).toBe('/csp-report');
    expect(isCspReportRequest('POST', '/csp-report')).toBe(true);
    expect(isCspReportRequest('GET', '/csp-report')).toBe(false);
    expect(isCspReportRequest('OPTIONS', '/csp-report')).toBe(false);
    expect(isCspReportRequest('POST', '/csp-report/x')).toBe(false);
  });

  it('refuses path tricks around the exempt route (trailing slash, case, double slash, prefix)', () => {
    for (const tricky of [
      '/csp-report/',
      '/CSP-REPORT',
      '//csp-report',
      '/csp-report-x',
    ]) {
      expect(isCspReportRequest('POST', tricky)).toBe(false);
    }
    expect(isCspReportRequest('POST', '/api/csp-report')).toBe(false);
    expect(isCspReportRequest('POST', '/auth/refresh')).toBe(false);
  });
});
