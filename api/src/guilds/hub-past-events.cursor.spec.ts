import {
  decodePastCursor,
  encodePastCursor,
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
      Buffer.from('{"e":"2026-10-01T22:00:00.000Z","i":1.5}').toString('base64url'),
    ],
    [
      'a non-positive id',
      Buffer.from('{"e":"2026-10-01T22:00:00.000Z","i":0}').toString('base64url'),
    ],
    [
      'a non-ISO time',
      Buffer.from('{"e":"yesterday","i":3}').toString('base64url'),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(decodePastCursor(raw)).toBeNull();
  });
});
