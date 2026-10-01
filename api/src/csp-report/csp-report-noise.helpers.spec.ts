import { isCloudflareBeaconCspReport } from './csp-report-noise.helpers';

const BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js/v31edd';
const RUM_CONNECT_URL = 'https://cloudflareinsights.com/cdn-cgi/rum';
const TWITCH_THUMBNAIL = 'https://static-cdn.jtvnw.net/previews-ttv/x.jpg';

/** Legacy `application/csp-report` body, as sampled from Sentry. */
const legacy = (blockedUri: unknown): unknown => ({
  'csp-report': {
    'document-uri': 'https://slot-3.gamernight.net/events',
    'blocked-uri': blockedUri,
    'effective-directive': 'script-src-elem',
    'violated-directive': 'script-src-elem',
  },
});

/** One Reporting API `application/reports+json` entry. */
const reportingEntry = (blockedURL: unknown): unknown => ({
  type: 'csp-violation',
  url: 'https://raid.gamernight.net/events',
  body: { blockedURL, effectiveDirective: 'connect-src' },
});

describe('isCloudflareBeaconCspReport (ROK-1501)', () => {
  describe('Cloudflare RUM beacon reports', () => {
    it.each([
      ['legacy beacon script', legacy(BEACON_URL)],
      ['legacy cdn-cgi/rum connect', legacy(RUM_CONNECT_URL)],
      ['Reporting API array (beacon)', [reportingEntry(BEACON_URL)]],
      ['Reporting API array (rum connect)', [reportingEntry(RUM_CONNECT_URL)]],
      ['Reporting API single object', reportingEntry(BEACON_URL)],
      [
        'Reporting API batch of beacon reports only',
        [reportingEntry(BEACON_URL), reportingEntry(RUM_CONNECT_URL)],
      ],
    ])('%s is beacon noise', (_label, report) => {
      expect(isCloudflareBeaconCspReport(report)).toBe(true);
    });
  });

  describe('every other report is still captured', () => {
    it.each([
      ['legacy jtvnw img-src', legacy(TWITCH_THUMBNAIL)],
      ['Reporting API jtvnw img-src', [reportingEntry(TWITCH_THUMBNAIL)]],
      ['legacy eval', legacy('eval')],
      ['legacy inline', legacy('inline')],
      ['Reporting API inline', [reportingEntry('inline')]],
      [
        'lookalike host (suffix appended)',
        legacy('https://cloudflareinsights.com.evil.example/x'),
      ],
      [
        'lookalike host (no dot boundary)',
        legacy('https://evilcloudflareinsights.com/x'),
      ],
      [
        'cloudflare host only in the path',
        legacy('https://evil.example/cloudflareinsights.com/beacon.min.js'),
      ],
      [
        'Reporting API batch mixing a real violation with a beacon',
        [reportingEntry(BEACON_URL), reportingEntry(TWITCH_THUMBNAIL)],
      ],
      [
        'Reporting API entry of another type',
        [{ type: 'deprecation', body: { blockedURL: BEACON_URL } }],
      ],
      ['empty blocked-uri', legacy('')],
      ['non-string blocked-uri', legacy(42)],
    ])('%s is not beacon noise', (_label, report) => {
      expect(isCloudflareBeaconCspReport(report)).toBe(false);
    });
  });

  describe('malformed or empty bodies', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string body', `{"csp-report":{"blocked-uri":"${BEACON_URL}"}}`],
      ['an empty object', {}],
      ['an empty array', []],
      ['a csp-report that is not an object', { 'csp-report': BEACON_URL }],
      ['a Reporting API entry with no body', [{ type: 'csp-violation' }]],
    ])('%s is not beacon noise', (_label, report) => {
      expect(isCloudflareBeaconCspReport(report)).toBe(false);
    });
  });
});
