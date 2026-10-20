/**
 * ROK-1598 L1 — T1 (exact request bodies) and T2 (multistatus parsing across
 * namespace-prefix variants, 404 propstats, relative hrefs, entities).
 */
import { TransientError } from '../calendar-provider.errors';
import * as xml from './apple-caldav-xml.helpers';

const DECL = '<?xml version="1.0" encoding="utf-8"?>';
const HOME = 'https://p07-caldav.icloud.com/1234567/calendars/';

/** The `TransientError` reason `fn` throws (`no-throw` / `not-transient`). */
function transientReason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof TransientError ? e.reason : 'not-transient';
  }
  return 'no-throw';
}

describe('CalDAV request bodies (T1)', () => {
  it('PROPFIND current-user-principal', () => {
    expect(xml.PROPFIND_PRINCIPAL).toBe(
      `${DECL}<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    );
  });

  it('PROPFIND calendar-home-set', () => {
    expect(xml.PROPFIND_HOME_SET).toBe(
      `${DECL}<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    );
  });

  it('PROPFIND Depth-1 collection props (D9)', () => {
    expect(xml.PROPFIND_COLLECTIONS).toBe(
      `${DECL}<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>` +
        '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/><d:current-user-privilege-set/><c:calendar-timezone/>' +
        '</d:prop></d:propfind>',
    );
  });

  it('PROPFIND getetag', () => {
    expect(xml.PROPFIND_ETAG).toBe(
      `${DECL}<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`,
    );
  });

  it('MKCALENDAR escapes the display name', () => {
    expect(xml.mkcalendarBody('Raid & <Ledger>')).toBe(
      `${DECL}<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop>` +
        '<d:displayname>Raid &amp; &lt;Ledger&gt;</d:displayname>' +
        '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' +
        '</d:prop></d:set></c:mkcalendar>',
    );
  });

  it('REPORT calendar-query with a UTC time-range and no expand', () => {
    const body = xml.calendarQueryBody({
      start: new Date('2026-10-20T00:00:00.000Z'),
      end: new Date('2026-11-17T23:59:59.999Z'),
    });
    expect(body).toBe(
      `${DECL}<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
        '<c:time-range start="20261020T000000Z" end="20261117T235959Z"/>' +
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>',
    );
    expect(body).not.toContain('expand');
  });
});

/** One home-set listing written with `D:` / `C:` / `CS:` prefixes. */
const LISTING = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
 <D:response><D:href>/1234567/calendars/</D:href>
  <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
 <D:response><D:href>/1234567/calendars/home/</D:href>
  <D:propstat><D:prop>
   <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
   <D:displayname>Home &amp; Raids</D:displayname>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>
   <CS:getctag>000123</CS:getctag>
   <D:current-user-privilege-set><D:privilege><D:read/></D:privilege><D:privilege><D:write-content/></D:privilege></D:current-user-privilege-set>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  <D:propstat><D:prop><C:calendar-timezone/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>
 <D:response><D:href>https://p07-caldav.icloud.com:443/1234567/calendars/work/</D:href>
  <D:propstat><D:prop>
   <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
   <D:current-user-privilege-set><D:privilege><D:read/></D:privilege></D:current-user-privilege-set>
  </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  <D:propstat><D:prop><CS:getctag/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>
 <D:response><D:href>/1234567/calendars/reminders/</D:href>
  <D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
   <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
 <D:response><D:href>/1234567/calendars/holidays/</D:href>
  <D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/><CS:subscribed/></D:resourcetype>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
 <D:response><D:href>/1234567/calendars/inbox/</D:href>
  <D:propstat><D:prop><D:resourcetype><D:collection/><C:schedule-inbox/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`;

const lowerCase = LISTING.replace(/D:/g, 'd:')
  .replace(/xmlns:D=/g, 'xmlns:d=')
  .replace(/C:/g, 'c:')
  .replace(/xmlns:C=/g, 'xmlns:c=');
const defaultNs = LISTING.replace(/<(\/?)D:/g, '<$1').replace(
  /xmlns:D=/g,
  'xmlns=',
);

const EXPECTED: xml.CalDavCollection[] = [
  {
    id: 'home',
    href: `${HOME}home/`,
    displayName: 'Home & Raids',
    components: ['VEVENT', 'VTODO'],
    ctag: '000123',
    writable: true,
    timezone: null,
  },
  {
    id: 'work',
    href: `${HOME}work/`,
    displayName: 'work',
    components: ['VEVENT'],
    ctag: null,
    writable: false,
    timezone: null,
  },
];

describe('parseMultiStatus + toCollections (T2)', () => {
  it.each([
    ['D: prefix', LISTING],
    ['d: prefix', lowerCase],
    ['default namespace', defaultNs],
  ])(
    '%s → VEVENT calendars only, absolute hrefs, 404 props ignored',
    (_, body) => {
      expect(xml.toCollections(xml.parseMultiStatus(body), HOME)).toEqual(
        EXPECTED,
      );
    },
  );

  it('keeps the propstat status of each response', () => {
    const ms = xml.parseMultiStatus(LISTING);
    expect(ms.responses[1]?.propstats.map((p) => p.status)).toEqual([200, 404]);
  });

  it('refuses an absolute href off the iCloud allowlist', () => {
    const hostile = LISTING.replace(
      '/1234567/calendars/reminders/',
      'https://evil.example/1234567/calendars/reminders/',
    );
    const ms = xml.parseMultiStatus(hostile);
    expect(transientReason(() => xml.toCollections(ms, HOME))).toBe(
      'href_refused',
    );
  });

  it.each([
    ['malformed', '<d:multistatus xmlns:d="DAV:"><d:response>'],
    ['empty', ''],
    [
      'not multistatus',
      '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>',
    ],
  ])('%s XML → TransientError(caldav_xml)', (_, body) => {
    expect(transientReason(() => xml.parseMultiStatus(body))).toBe(
      'caldav_xml',
    );
  });

  it('an empty multistatus has no responses', () => {
    expect(xml.parseMultiStatus('<d:multistatus xmlns:d="DAV:"/>')).toEqual({
      responses: [],
    });
  });
});

describe('principal / home-set / etag extractors (T2)', () => {
  const principal = `<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop>
    <current-user-principal><href>/1234567/principal/</href></current-user-principal>
    </prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

  it('resolves a relative principal href against the responding URL', () => {
    const ms = xml.parseMultiStatus(principal);
    expect(xml.principalHref(ms, 'https://p07-caldav.icloud.com/')).toBe(
      'https://p07-caldav.icloud.com/1234567/principal/',
    );
    expect(xml.homeSetHref(ms, 'https://p07-caldav.icloud.com/')).toBeNull();
  });

  it('normalises an absolute :443 home-set href', () => {
    const body = `<A:multistatus xmlns:A="DAV:" xmlns:B="urn:ietf:params:xml:ns:caldav"><A:response><A:href>/1234567/principal/</A:href><A:propstat><A:prop>
      <B:calendar-home-set><A:href>https://p07-caldav.icloud.com:443/1234567/calendars/</A:href></B:calendar-home-set>
      </A:prop><A:status>HTTP/1.1 200 OK</A:status></A:propstat></A:response></A:multistatus>`;
    expect(
      xml.homeSetHref(xml.parseMultiStatus(body), 'https://caldav.icloud.com/'),
    ).toBe(HOME);
  });

  it('firstEtag skips a 404 propstat', () => {
    const body = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/x.ics</d:href>
      <d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
      <d:response><d:href>/y.ics</d:href><d:propstat><d:prop><d:getetag>"e9"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    expect(xml.firstEtag(xml.parseMultiStatus(body))).toBe('"e9"');
  });
});

describe('toCalendarObjects (T2)', () => {
  const ICS = 'BEGIN:VCALENDAR\r\nSUMMARY:a < b & c\r\nEND:VCALENDAR';
  const body = `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response><D:href>/1234567/calendars/home/a.ics</D:href><D:propstat><D:prop>
      <D:getetag>&quot;e1&quot;</D:getetag><C:calendar-data>${xml.escapeXml(ICS)}</C:calendar-data>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
    <D:response><D:href>/1234567/calendars/home/b.ics</D:href><D:propstat><D:prop>
      <C:calendar-data content-type="text/calendar"><![CDATA[${ICS}]]></C:calendar-data>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
    <D:response><D:href>/1234567/calendars/home/gone.ics</D:href><D:propstat><D:prop>
      <C:calendar-data/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>
  </D:multistatus>`;

  it('decodes entities and CDATA, skips 404 propstats, absolutises hrefs', () => {
    // XML 1.0 §2.11 normalises CRLF → LF in text AND CDATA, so the iCal
    // parser downstream receives LF line endings.
    const lf = ICS.replace(/\r\n/g, '\n');
    const objects = xml.toCalendarObjects(xml.parseMultiStatus(body), HOME);
    expect(objects).toEqual([
      { href: `${HOME}home/a.ics`, etag: '"e1"', ics: lf },
      { href: `${HOME}home/b.ics`, etag: null, ics: lf },
    ]);
  });
});

describe('decodeXmlText', () => {
  it.each([
    ['&amp;lt;', '&lt;'],
    ['&#65;&#x1F600;', 'A\u{1F600}'],
    ['&unknown; &#0;', '&unknown; &#0;'],
    ['&quot;&apos;&gt;', '"\'>'],
  ])('%s → %s', (raw, decoded) => {
    expect(xml.decodeXmlText(raw)).toBe(decoded);
  });
});
