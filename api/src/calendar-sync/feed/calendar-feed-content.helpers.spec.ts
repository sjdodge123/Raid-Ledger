import { readFileSync } from 'fs';
import { join } from 'path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import {
  buildFeedCalendar,
  feedWindow,
  loadFeedEntries,
  type FeedEntry,
} from './calendar-feed-content.helpers';
import { serializeIcsCalendar } from './ics-serialize.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = new Date('2026-10-15T12:00:00.000Z');
const OPTS = { clientUrl: 'https://raid.example.test/', userId: 7, now: NOW };

/** Confirmed (long + escaped title), tentative, and tentative-on-bench. */
const GOLDEN_ENTRIES: FeedEntry[] = [
  {
    eventId: 101,
    title:
      'Molten Core; full clear, then Onyxia \\ loot council — bring fire resist 🔥 and consumables',
    start: new Date('2026-10-16T19:00:00.000Z'),
    end: new Date('2026-10-16T22:30:00.000Z'),
    tentative: false,
    benched: false,
  },
  {
    eventId: 102,
    title: "Zul'Gurub, alt run",
    start: new Date('2026-10-18T18:00:00.000Z'),
    end: new Date('2026-10-18T20:00:00.000Z'),
    tentative: true,
    benched: false,
  },
  {
    eventId: 103,
    title: 'Blackwing Lair',
    start: new Date('2026-10-20T19:00:00.000Z'),
    end: new Date('2026-10-20T23:00:00.000Z'),
    tentative: true,
    benched: true,
  },
];

const golden = () =>
  readFileSync(join(__dirname, '__fixtures__', 'feed-golden.ics'), 'utf8');

describe('buildFeedCalendar + serializeIcsCalendar — golden feed', () => {
  it('matches feed-golden.ics byte for byte (CRLF, folding, escaping)', () => {
    const ics = serializeIcsCalendar(buildFeedCalendar(GOLDEN_ENTRIES, OPTS));
    expect(ics).toBe(golden().replace(/\r?\n/g, '\r\n'));
  });

  it('every physical line is ≤75 octets', () => {
    const ics = serializeIcsCalendar(buildFeedCalendar(GOLDEN_ENTRIES, OPTS));
    const long = ics
      .split('\r\n')
      .filter((l) => Buffer.byteLength(l, 'utf8') > 75);
    expect(long).toEqual([]);
  });
});

describe('buildFeedCalendar — presentation', () => {
  const events = buildFeedCalendar(GOLDEN_ENTRIES, OPTS).events;

  it('confirmed is Busy with the plain title', () => {
    expect(events[0]?.transparency).toBe('OPAQUE');
    expect(events[0]?.summary).toBe(GOLDEN_ENTRIES[0]?.title);
  });

  it('tentative is Free and titled "(Tentative) …"', () => {
    expect(events[1]?.transparency).toBe('TRANSPARENT');
    expect(events[1]?.summary).toBe("(Tentative) Zul'Gurub, alt run");
  });

  it('bench wins over tentative: Free and titled "(Bench) …"', () => {
    expect(events[2]?.transparency).toBe('TRANSPARENT');
    expect(events[2]?.summary).toBe('(Bench) Blackwing Lair');
  });

  it('UID is the shared copy id and the url drops the trailing slash', () => {
    expect(events[0]?.uid).toMatch(/^rl:[0-9a-f]{12}:101:7$/);
    expect(events[0]?.url).toBe('https://raid.example.test/events/101');
  });
});

describe('feedWindow', () => {
  it('spans now − 7 days to now + 90 days', () => {
    expect(feedWindow(NOW)).toEqual({
      from: new Date('2026-10-08T12:00:00.000Z'),
      to: new Date('2027-01-13T12:00:00.000Z'),
    });
  });
});

describe('loadFeedEntries — row mapping', () => {
  it('parses UTC bounds and maps status/bench to flags', async () => {
    const db = createDrizzleMock();
    db.orderBy.mockResolvedValue([
      {
        eventId: 5,
        title: 'Raid',
        status: 'tentative',
        start: '2026-10-16T19:00:00.000Z',
        end: '2026-10-16T22:00:00.000Z',
        benched: false,
      },
      {
        eventId: 6,
        title: 'Raid 2',
        status: 'signed_up',
        start: '2026-10-17T19:00:00.000Z',
        end: '2026-10-17T22:00:00.000Z',
        benched: true,
      },
    ]);
    expect(await loadFeedEntries(db as unknown as Db, 7, NOW)).toEqual([
      {
        eventId: 5,
        title: 'Raid',
        start: new Date('2026-10-16T19:00:00.000Z'),
        end: new Date('2026-10-16T22:00:00.000Z'),
        tentative: true,
        benched: false,
      },
      {
        eventId: 6,
        title: 'Raid 2',
        start: new Date('2026-10-17T19:00:00.000Z'),
        end: new Date('2026-10-17T22:00:00.000Z'),
        tentative: false,
        benched: true,
      },
    ]);
  });
});
