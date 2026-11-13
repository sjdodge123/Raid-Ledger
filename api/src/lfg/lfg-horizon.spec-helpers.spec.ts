import { minutesFromNow } from './lfg-horizon.spec-helpers';

describe('minutesFromNow', () => {
  afterEach(() => jest.useRealTimers());

  it('reads an expiry 15 s ahead (POST at 03:59:45Z, tonight = 04:00Z) as > 0', () => {
    jest.useFakeTimers({ now: new Date('2026-11-13T03:59:45Z') });

    expect(minutesFromNow('2026-11-13T04:00:00Z')).toBeGreaterThan(0);
  });

  it('keeps whole-minute horizons exact a few ms after the POST', () => {
    jest.useFakeTimers({ now: new Date('2026-11-13T12:00:00.250Z') });

    expect(minutesFromNow(new Date('2026-11-13T12:30:00Z'))).toBe(30);
  });

  it('reads an expiry already in the past as <= 0', () => {
    jest.useFakeTimers({ now: new Date('2026-11-13T04:00:30Z') });

    expect(minutesFromNow('2026-11-13T04:00:00Z')).toBeLessThanOrEqual(0);
  });
});
