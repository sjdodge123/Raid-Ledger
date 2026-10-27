/**
 * ROK-1968 §8.2 — pure session-note helpers: the lazy auto-clear predicate
 * (T-U1), the checklist rewrite plan (T-U2) and the body pipeline.
 */
import { BadRequestException } from '@nestjs/common';
import {
  isNoteExpired,
  noteBody,
  planItemRewrite,
  toClearAfter,
  type PinnedEventRow,
} from './hub-session-note.helpers';

const NOW = new Date('2026-10-26T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function pin(over: Partial<PinnedEventRow> = {}): PinnedEventRow {
  return {
    id: 5,
    title: 'Raid night',
    duration: [
      new Date(NOW.getTime() - 3 * HOUR),
      new Date(NOW.getTime() - HOUR),
    ],
    cancelledAt: null,
    ...over,
  };
}

function badRequestBody(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    if (err instanceof BadRequestException) return err.getResponse();
    throw err;
  }
  throw new Error('expected a BadRequestException');
}

describe('isNoteExpired (T-U1)', () => {
  it('is true once the pinned event has ended', () => {
    expect(isNoteExpired(pin(), NOW)).toBe(true);
  });

  it('is false when the pinned event was cancelled (ruling 5)', () => {
    expect(isNoteExpired(pin({ cancelledAt: NOW }), NOW)).toBe(false);
  });

  it('is false while the pinned event is running (ruling 4c)', () => {
    const running = pin({
      duration: [new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() + 1)],
    });
    expect(isNoteExpired(running, NOW)).toBe(false);
  });

  it('is false for an unpinned note', () => {
    expect(isNoteExpired(null, NOW)).toBe(false);
  });

  it('is true when the event ends exactly now (boundary)', () => {
    const endsNow = pin({ duration: [new Date(NOW.getTime() - HOUR), NOW] });
    expect(isNoteExpired(endsNow, NOW)).toBe(true);
  });
});

describe('toClearAfter', () => {
  it('names the pinned event', () => {
    expect(toClearAfter(pin())).toEqual({
      eventId: 5,
      title: 'Raid night',
      startTime: '2026-10-26T17:00:00.000Z',
      endTime: '2026-10-26T19:00:00.000Z',
    });
  });

  it('reads a cancelled pin as no auto-clear (ruling 5)', () => {
    expect(toClearAfter(pin({ cancelledAt: NOW }))).toBeNull();
  });
});

describe('planItemRewrite (T-U2)', () => {
  it('keeps listed ids, inserts new rows and deletes missing ones', () => {
    const plan = planItemRewrite(
      [1, 2, 3],
      [{ id: 3, text: 'Potions' }, { text: 'Food' }, { id: 1, text: 'Gear' }],
    );
    expect(plan).toEqual({
      keep: [
        { id: 3, text: 'Potions', position: 0 },
        { id: 1, text: 'Gear', position: 2 },
      ],
      insert: [{ text: 'Food', position: 1 }],
      deleteIds: [2],
    });
  });

  it('rejects an id the hub does not own', () => {
    expect(
      badRequestBody(() => planItemRewrite([1], [{ id: 9, text: 'x' }])),
    ).toEqual({ items: ['That checklist item no longer exists'] });
  });

  it('rejects an id listed twice', () => {
    const twice = [
      { id: 1, text: 'a' },
      { id: 1, text: 'b' },
    ];
    expect(badRequestBody(() => planItemRewrite([1], twice))).toEqual({
      items: ['That checklist item no longer exists'],
    });
  });
});

describe('noteBody', () => {
  it('rejects a note with a blank body and no items', () => {
    expect(badRequestBody(() => noteBody('  \n ', 0))).toEqual({
      body: ['Add a note or at least one checklist item'],
    });
  });

  it('allows a blank body when the checklist has items', () => {
    expect(noteBody('   ', 2)).toBe('');
  });

  it('keeps a valid markdown body', () => {
    expect(noteBody('Bring **potions**', 0)).toBe('Bring **potions**');
  });
});
