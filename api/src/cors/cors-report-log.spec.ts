/**
 * ROK-1732 T2 — `[cors-auto]` evidence lines: exact format, the privacy
 * contract (AC6), sanitising, rate limit, key cap and host-check dedupe.
 */
import {
  clientUrlMatch,
  createCorsReporter,
  formatWouldReject,
  MAX_HOST_CHECK_PAIRS,
  MAX_REPORT_KEYS,
  REPORT_WINDOW_MS,
  sanitizeField,
  sanitizeOrigin,
  sanitizePath,
  type CorsReportInput,
} from './cors-report-log';

const SIBLING: CorsReportInput = {
  reason: 'host-mismatch',
  origin: 'https://slot-1.gamernight.net',
  host: 'raid.gamernight.net',
  sfs: 'same-site',
  method: 'POST',
  path: '/auth/refresh',
  clientUrl: 'https://raid.gamernight.net',
};

function harness() {
  let clock = 1_000_000;
  const logger = { warn: jest.fn(), log: jest.fn() };
  const reporter = createCorsReporter(logger, () => clock);
  const advance = (ms: number) => {
    clock += ms;
  };
  return { logger, reporter, advance };
}

describe('would-reject line format', () => {
  it('matches the spec D3(a) line exactly', () => {
    expect(formatWouldReject(SIBLING, 0)).toBe(
      '[cors-auto] would-reject reason=host-mismatch ' +
        'origin=https://slot-1.gamernight.net host=raid.gamernight.net ' +
        'xfh=- sfs=same-site method=POST path=/auth/refresh ' +
        'client_url_match=no suppressed=0',
    );
  });

  it('never logs a query string or fragment (magic-link tokens)', () => {
    const line = formatWouldReject(
      { ...SIBLING, path: '/auth/magic?token=abc#x' },
      0,
    );
    expect(line).toContain(' path=/auth/magic ');
    expect(line).not.toContain('token');
    expect(line).not.toContain('abc');
  });

  it('carries no IP / XFF / cookie / auth / UA / referer field (AC6)', () => {
    const line = formatWouldReject(SIBLING, 0);
    const keys = line.match(/\b[a-z_]+=/g);
    expect(keys).toEqual([
      'reason=',
      'origin=',
      'host=',
      'xfh=',
      'sfs=',
      'method=',
      'path=',
      'client_url_match=',
      'suppressed=',
    ]);
  });
});

describe('field sanitising', () => {
  it('reduces the Origin to scheme://host[:port] (drops userinfo and path)', () => {
    expect(sanitizeOrigin('https://user:hunter2@evil.example:8443/x?y=1')).toBe(
      'https://evil.example:8443',
    );
    expect(sanitizeOrigin('null')).toBe('null');
    expect(sanitizeOrigin(undefined)).toBe('-');
  });

  it('strips spaces and control chars so a header cannot forge fields, and caps length', () => {
    expect(sanitizeField('evil host=raid\r\nx')).toBe('evilhost=raidx');
    expect(sanitizeField('a'.repeat(500))).toHaveLength(120);
    expect(sanitizeField(' \t ')).toBe('-');
    expect(sanitizePath(undefined)).toBe('-');
    const line = formatWouldReject({ ...SIBLING, host: 'x suppressed=99' }, 0);
    expect(line.match(/ suppressed=/g)).toHaveLength(1);
  });

  it('reports client_url_match yes / no / unset against the trusted CLIENT_URL', () => {
    const trusted = 'https://raid.gamernight.net/';
    expect(clientUrlMatch('https://raid.gamernight.net', trusted)).toBe('yes');
    expect(clientUrlMatch('https://slot-1.gamernight.net', trusted)).toBe('no');
    expect(clientUrlMatch('null', trusted)).toBe('no');
    expect(clientUrlMatch('https://raid.gamernight.net', undefined)).toBe(
      'unset',
    );
    expect(clientUrlMatch('https://raid.gamernight.net', 'garbage')).toBe(
      'unset',
    );
  });
});

describe('would-reject rate limit', () => {
  it('emits the first line, suppresses repeats within 10 min, then emits with the count', () => {
    const { logger, reporter, advance } = harness();
    reporter.wouldReject(SIBLING);
    advance(REPORT_WINDOW_MS - 1);
    reporter.wouldReject(SIBLING);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/ suppressed=0$/);
    advance(1);
    reporter.wouldReject(SIBLING);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1][0]).toMatch(/ suppressed=1$/);
  });

  it('keys on reason|origin|host — a different pair is not suppressed', () => {
    const { logger, reporter } = harness();
    reporter.wouldReject(SIBLING);
    reporter.wouldReject({
      ...SIBLING,
      origin: 'https://slot-2.gamernight.net',
    });
    const noHost: CorsReportInput = { ...SIBLING, reason: 'no-host' };
    delete noHost.host;
    reporter.wouldReject(noHost);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it(`caps distinct keys at ${MAX_REPORT_KEYS}; new keys go to one overflow counter`, () => {
    const { logger, reporter, advance } = harness();
    const nth = (i: number) => ({
      ...SIBLING,
      origin: `https://s${i}.example`,
    });
    for (let i = 0; i < MAX_REPORT_KEYS; i += 1) reporter.wouldReject(nth(i));
    expect(logger.warn).toHaveBeenCalledTimes(MAX_REPORT_KEYS);
    reporter.wouldReject(nth(MAX_REPORT_KEYS));
    expect(logger.warn).toHaveBeenLastCalledWith(
      '[cors-auto] would-reject overflow suppressed=1',
    );
    reporter.wouldReject(nth(MAX_REPORT_KEYS + 1));
    reporter.wouldReject(nth(MAX_REPORT_KEYS + 2));
    expect(logger.warn).toHaveBeenCalledTimes(MAX_REPORT_KEYS + 1);
    advance(REPORT_WINDOW_MS);
    reporter.wouldReject(nth(MAX_REPORT_KEYS + 3));
    expect(logger.warn).toHaveBeenLastCalledWith(
      '[cors-auto] would-reject overflow suppressed=3',
    );
  });
});

describe('host-check line', () => {
  const OK: CorsReportInput = {
    reason: 'same-host',
    origin: 'https://raid.gamernight.net',
    host: 'raid.gamernight.net',
    sfs: 'same-origin',
  };

  it('logs the D3(b) line once per Origin/Host pair', () => {
    const { logger, reporter } = harness();
    reporter.hostCheck(OK);
    reporter.hostCheck(OK);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      '[cors-auto] host-check ok origin=https://raid.gamernight.net ' +
        'host=raid.gamernight.net xfh=- sfs=same-origin',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it(`stops after ${MAX_HOST_CHECK_PAIRS} distinct pairs`, () => {
    const { logger, reporter } = harness();
    for (let i = 0; i < MAX_HOST_CHECK_PAIRS + 5; i += 1) {
      reporter.hostCheck({ ...OK, host: `h${i}.example` });
    }
    expect(logger.log).toHaveBeenCalledTimes(MAX_HOST_CHECK_PAIRS);
  });
});
