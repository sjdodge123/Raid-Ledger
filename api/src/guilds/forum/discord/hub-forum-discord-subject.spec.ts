/**
 * ROK-2272 S8 — `subjectOf` and the subject post title: poll / lineup posts
 * read `<title> — Poll|Lineup` within Discord's 100-char name, an event
 * keeps its dated title.
 */
import { subjectOf, subjectPostTitle } from './hub-forum-discord-subject';

const NONE = { eventId: null, matchId: null, lineupId: null };

describe('subjectOf', () => {
  it('reads the one subject a thread carries', () => {
    expect(subjectOf({ ...NONE, eventId: 1 })).toEqual({
      kind: 'event',
      id: 1,
    });
    expect(subjectOf({ ...NONE, matchId: 2 })).toEqual({ kind: 'poll', id: 2 });
    expect(subjectOf({ ...NONE, lineupId: 3 })).toEqual({
      kind: 'lineup',
      id: 3,
    });
  });

  it('is null for a plain thread', () => {
    expect(subjectOf(NONE)).toBeNull();
  });

  it('prefers the event, then the poll, should several be set', () => {
    expect(subjectOf({ eventId: 1, matchId: 2, lineupId: 3 })).toEqual({
      kind: 'event',
      id: 1,
    });
    expect(subjectOf({ ...NONE, matchId: 2, lineupId: 3 })).toEqual({
      kind: 'poll',
      id: 2,
    });
  });
});

describe('subjectPostTitle', () => {
  it('suffixes poll and lineup titles', () => {
    expect(subjectPostTitle('poll', 'Friday raid')).toBe('Friday raid — Poll');
    expect(subjectPostTitle('lineup', ' Game night ')).toBe(
      'Game night — Lineup',
    );
  });

  it('falls back when the title is blank', () => {
    expect(subjectPostTitle('poll', '   ')).toBe('Scheduling — Poll');
    expect(subjectPostTitle('lineup', '')).toBe('Lineup — Lineup');
  });

  it('cuts a long title at a word boundary and keeps the suffix within 100', () => {
    const title = `${'word '.repeat(30)}end`;
    const out = subjectPostTitle('poll', title);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(' — Poll')).toBe(true);
    expect(out.startsWith('word word')).toBe(true);
  });

  it('delegates an event with its start to the dated event title', () => {
    const start = new Date('2025-11-22T19:00:00Z');
    expect(subjectPostTitle('event', 'Molten Core', start, 'UTC')).toBe(
      'Molten Core — Sat 22 Nov',
    );
  });
});
