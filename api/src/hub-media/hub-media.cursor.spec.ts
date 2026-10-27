import { BadRequestException } from '@nestjs/common';
import {
  decodeHubMediaCursor,
  encodeHubMediaCursor,
  kindsForFilter,
} from './hub-media.cursor';

describe('hub media cursor (ROK-1942 D13)', () => {
  it('round-trips (captured_at, id)', () => {
    const c = { capturedAt: new Date('2026-10-20T12:34:56.789Z'), id: 42 };
    expect(decodeHubMediaCursor(encodeHubMediaCursor(c))).toEqual(c);
  });

  it.each([
    ['garbage', Buffer.from('nope').toString('base64url')],
    ['bad date', Buffer.from('x|4').toString('base64url')],
    ['zero id', Buffer.from('2026-10-20T00:00:00Z|0').toString('base64url')],
    [
      'extra part',
      Buffer.from('2026-10-20T00:00:00Z|4|9').toString('base64url'),
    ],
  ])('refuses %s with 400', (_label, raw) => {
    expect(() => decodeHubMediaCursor(raw)).toThrow(BadRequestException);
  });
});

describe('kindsForFilter (All · Deaths · Screenshots)', () => {
  it('maps screenshot to screenshot + image, others to themselves, none to all', () => {
    expect({
      none: kindsForFilter(undefined),
      death: kindsForFilter('death'),
      screenshot: kindsForFilter('screenshot'),
      image: kindsForFilter('image'),
    }).toEqual({
      none: null,
      death: ['death'],
      screenshot: ['screenshot', 'image', 'upload'],
      image: ['image'],
    });
  });
});
