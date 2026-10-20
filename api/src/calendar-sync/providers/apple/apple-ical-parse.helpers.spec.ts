import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCopyId, deriveInstanceId } from '../rl-copy-id.helpers';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8').replace(
    /\r?\n/g,
    '\r\n',
  );

const range = {
  start: new Date('2026-10-20T00:00:00Z'),
  end: new Date('2026-11-17T00:00:00Z'),
};
const parse = (name: string) =>
  parseBusyFromIcs(fixture(name), { range, calendarTimezone: null });
const starts = (r: { blocks: { start: Date }[] }) =>
  r.blocks.map((b) => b.start.toISOString());

describe('parseBusyFromIcs — privacy (T6, §6.4.1)', () => {
  it('returns only BusyBlock keys and none of the private text', () => {
    const result = parse('privacy.ics');
    expect(result.blocks).toHaveLength(1);
    const allowed = ['start', 'end', 'allDay', 'allDayDates', 'ourId'];
    for (const block of result.blocks) {
      expect(Object.keys(block).filter((k) => !allowed.includes(k))).toEqual(
        [],
      );
    }
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
});

describe('parseBusyFromIcs — TRANSP / STATUS (T12)', () => {
  it('drops TRANSPARENT and CANCELLED, keeps TENTATIVE + OPAQUE as busy', () => {
    expect(starts(parse('transp-status.ics'))).toEqual([
      '2026-10-23T18:00:00.000Z',
    ]);
  });
});

describe('parseBusyFromIcs — ourId (T13, D5)', () => {
  const result = parse('our-ids.ics');
  const idAt = (iso: string) =>
    result.blocks.find((b) => b.start.toISOString() === iso)?.ourId;

  it('prefers X-RAID-LEDGER-ID over a rewritten UID', () => {
    expect(idAt('2026-10-21T18:00:00.000Z')).toBe('rl:0123456789ab:42:7');
  });

  it('falls back to a copy-id UID', () => {
    expect(idAt('2026-10-22T18:00:00.000Z')).toBe('rl:0123456789ab:43:7');
  });

  it('maps a legacy rl-<event>-<user>@<host> UID to that host’s copy id', () => {
    const expected = buildCopyId({
      instanceId: deriveInstanceId('raid.example'),
      eventId: 42,
      userId: 7,
    });
    expect(idAt('2026-10-23T18:00:00.000Z')).toBe(expected);
  });

  it('leaves ourId off a foreign event (invalid X-prop, foreign UID)', () => {
    const foreign = result.blocks.find(
      (b) => b.start.toISOString() === '2026-10-24T18:00:00.000Z',
    );
    expect(foreign).toBeDefined();
    expect(foreign && 'ourId' in foreign).toBe(false);
  });

  it('stamps ourId on every occurrence of a recurring copy', () => {
    expect(idAt('2026-10-25T18:00:00.000Z')).toBe('rl:0123456789ab:44:7');
    expect(idAt('2026-10-26T18:00:00.000Z')).toBe('rl:0123456789ab:44:7');
  });
});

describe('parseBusyFromIcs — malformed input (T14)', () => {
  it('skips the bad object and still returns the good ones', () => {
    const result = parse('malformed-mixed.ics');
    expect(starts(result)).toEqual([
      '2026-10-21T18:00:00.000Z',
      '2026-10-23T18:00:00.000Z',
    ]);
    expect(result.skipped).toBe(1);
  });

  it('never throws on garbage, and counts it as one skipped object', () => {
    const result = parseBusyFromIcs('not an ics at all', {
      range,
      calendarTimezone: null,
    });
    expect(result).toEqual({ blocks: [], skipped: 1 });
  });

  it('returns nothing for empty input', () => {
    expect(parseBusyFromIcs('', { range, calendarTimezone: null })).toEqual({
      blocks: [],
      skipped: 0,
    });
  });
});

describe('parseBusyFromIcs — window edges', () => {
  it('excludes blocks touching the edges, keeps straddlers unclipped, drops zero-length', () => {
    const result = parse('window-edges.ics');
    expect(
      result.blocks.map((b) => [b.start.toISOString(), b.end.toISOString()]),
    ).toEqual([
      ['2026-10-19T23:00:00.000Z', '2026-10-20T01:00:00.000Z'],
      ['2026-11-16T23:00:00.000Z', '2026-11-17T01:00:00.000Z'],
    ]);
    expect(result.skipped).toBe(0);
  });
});
