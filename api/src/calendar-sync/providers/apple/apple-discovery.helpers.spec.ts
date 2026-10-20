import { collectionUrl, isSafeSegment } from './apple-discovery.helpers';

const HOME = 'https://p07-caldav.icloud.com/1234567/calendars/';

describe('isSafeSegment + collectionUrl (review r1 — encoded dots)', () => {
  it.each(['%2e%2e', '%2E%2E', '.%2e', '%2e', 'a%2eb'])(
    'refuses %s (WHATWG resolves %%2e as a dot)',
    (seg) => {
      expect(isSafeSegment(seg)).toBe(false);
      expect(collectionUrl(HOME, seg)).toBeNull();
    },
  );

  it.each(['home', 'raid-ledger-1', 'a.b_c~d', 'x%20y'])('keeps %s', (seg) => {
    expect(isSafeSegment(seg)).toBe(true);
    expect(collectionUrl(HOME, seg)).toBe(`${HOME}${seg}/`);
  });
});
