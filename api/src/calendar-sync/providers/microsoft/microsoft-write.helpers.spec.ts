/**
 * ROK-1597 T15 + T17: the pure half of the Graph write helpers — the exact
 * copy bodies (busy/free + title prefixes, zone-less UTC times, our extended
 * property, no attendees), the `'primary'` alias, URL encoding, the adopt
 * `$filter`, and the pinned extended-property id.
 */
import type { CopyEventInput } from '../calendar-provider.interface';
import { RL_COPY_PROP_ID } from './microsoft-graph.constants';
import {
  buildCopyIdLookupUrl,
  buildMicrosoftEventBody,
  buildMicrosoftPatchBody,
  calendarEventsPath,
  eventUrl,
  RAID_LEDGER_CALENDAR_NAME,
  readCopyRef,
  toGraphDateTime,
} from './microsoft-write.helpers';

const COPY: CopyEventInput = {
  copyId: 'rl:0123456789ab:42:7',
  title: 'Molten Core',
  description: 'https://raid.example.test/events/42',
  url: 'https://raid.example.test/events/42',
  start: new Date('2026-11-01T19:00:00.000Z'),
  end: new Date('2026-11-01T22:00:00.000Z'),
  tentative: false,
};

describe('RL_COPY_PROP_ID (T17)', () => {
  it('is pinned forever — changing it orphans every copy already written', () => {
    expect(RL_COPY_PROP_ID).toBe(
      'String {5ee82885-bb24-48df-8d4a-123f14548871} Name rlCopyId',
    );
  });

  it('the dedicated calendar keeps the name "Raid Ledger"', () => {
    expect(RAID_LEDGER_CALENDAR_NAME).toBe('Raid Ledger');
  });
});

describe('buildMicrosoftEventBody (T15)', () => {
  it('a confirmed copy is the plain title, busy, UTC zone-less times and our property', () => {
    expect(buildMicrosoftEventBody(COPY)).toEqual({
      subject: 'Molten Core',
      body: {
        contentType: 'text',
        content: 'https://raid.example.test/events/42',
      },
      start: { dateTime: '2026-11-01T19:00:00.000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-01T22:00:00.000', timeZone: 'UTC' },
      showAs: 'busy',
      singleValueExtendedProperties: [
        { id: RL_COPY_PROP_ID, value: 'rl:0123456789ab:42:7' },
      ],
    });
  });

  it('tentative → "(Tentative) " + free; benched → "(Bench) " + free (ruled 2026-10-08)', () => {
    const tentative = buildMicrosoftEventBody({ ...COPY, tentative: true });
    expect([tentative.subject, tentative.showAs]).toEqual([
      '(Tentative) Molten Core',
      'free',
    ]);
    const bench = buildMicrosoftEventBody({ ...COPY, benched: true });
    expect([bench.subject, bench.showAs]).toEqual([
      '(Bench) Molten Core',
      'free',
    ]);
  });

  it('never carries attendees, location or reminders keys', () => {
    const keys = Object.keys(buildMicrosoftEventBody(COPY)).sort();
    expect(keys).toEqual([
      'body',
      'end',
      'showAs',
      'singleValueExtendedProperties',
      'start',
      'subject',
    ]);
  });

  it('the PATCH body omits the extended property (already on the copy)', () => {
    expect(buildMicrosoftPatchBody(COPY)).not.toHaveProperty(
      'singleValueExtendedProperties',
    );
  });

  it('toGraphDateTime drops only the trailing Z', () => {
    expect(toGraphDateTime(new Date('2026-03-29T01:30:15.250Z'))).toEqual({
      dateTime: '2026-03-29T01:30:15.250',
      timeZone: 'UTC',
    });
  });
});

describe('Graph write URLs (T15)', () => {
  it("'primary' is the main calendar; other ids are encoded", () => {
    expect(calendarEventsPath('primary')).toBe(
      'https://graph.microsoft.com/v1.0/me/calendar/events',
    );
    expect(calendarEventsPath('AAMk/a+b=')).toBe(
      'https://graph.microsoft.com/v1.0/me/calendars/AAMk%2Fa%2Bb%3D/events',
    );
    expect(eventUrl('AAMk=1')).toBe(
      'https://graph.microsoft.com/v1.0/me/events/AAMk%3D1',
    );
  });

  it('the adopt lookup filters on our property + copy id in that calendar only', () => {
    const url = buildCopyIdLookupUrl('cal=1', 'rl:0123456789ab:42:7');
    const [path, query = ''] = url.split('?');
    expect(path).toBe(
      'https://graph.microsoft.com/v1.0/me/calendars/cal%3D1/events',
    );
    const params = new URLSearchParams(query);
    expect(params.get('$filter')).toBe(
      `singleValueExtendedProperties/Any(ep: ep/id eq '${RL_COPY_PROP_ID}'` +
        ` and ep/value eq 'rl:0123456789ab:42:7')`,
    );
    expect(params.get('$select')).toBe('id');
    expect(params.get('$top')).toBe('1');
  });
});

describe('readCopyRef', () => {
  it('keeps the caller calendar id and the @odata.etag', () => {
    expect(
      readCopyRef({ id: 'evt=1', '@odata.etag': 'W/"x"' }, 'primary'),
    ).toEqual({
      calendarId: 'primary',
      providerEventId: 'evt=1',
      etag: 'W/"x"',
    });
  });

  it('a reply without an id is malformed (transient)', () => {
    expect(() => readCopyRef({}, 'primary')).toThrow('malformed_response');
  });
});
