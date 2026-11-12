import { BadRequestException } from '@nestjs/common';
import {
  decodePastCursor,
  encodePastCursor,
  parsePastEventsQuery,
} from './hub-past-events.cursor';

/** ROK-2185 item 3 — the opaque keyset cursor of `guilds/:id/events/past`. */
describe('past-events cursor', () => {
  const key = { endsAt: new Date('2026-10-01T22:00:00.123Z'), id: 42 };

  it('round-trips the (ends, id) key', () => {
    expect(decodePastCursor(encodePastCursor(key))).toEqual(key);
  });

  it('is URL-safe base64 (no +, / or = padding)', () => {
    expect(encodePastCursor(key)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 JSON', 'garbage!!'],
    ['JSON that is not an object', Buffer.from('[1,2]').toString('base64url')],
    [
      'a non-integer id',
      Buffer.from('{"e":"2026-10-01T22:00:00.000Z","i":1.5}').toString(
        'base64url',
      ),
    ],
    [
      'a non-positive id',
      Buffer.from('{"e":"2026-10-01T22:00:00.000Z","i":0}').toString(
        'base64url',
      ),
    ],
    [
      'a non-ISO time',
      Buffer.from('{"e":"yesterday","i":3}').toString('base64url'),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(decodePastCursor(raw)).toBeNull();
  });
});

describe('parsePastEventsQuery', () => {
  const key = { endsAt: new Date('2026-10-01T22:00:00.000Z'), id: 9 };

  it('no cursor → the newest page (null)', () => {
    expect(parsePastEventsQuery({})).toBeNull();
  });

  it('a valid cursor → its key', () => {
    expect(parsePastEventsQuery({ cursor: encodePastCursor(key) })).toEqual(
      key,
    );
  });

  it.each([
    ['an undecodable cursor', { cursor: 'garbage!!' }],
    ['an empty cursor', { cursor: '' }],
    ['a repeated cursor param', { cursor: ['a', 'b'] }],
  ])('400 on %s', (_label, query) => {
    expect(() => parsePastEventsQuery(query)).toThrow(BadRequestException);
  });
});
