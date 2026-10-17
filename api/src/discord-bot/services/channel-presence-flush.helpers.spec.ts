/**
 * ROK-1498 — the join-side session boundary and the D8 close predicate.
 *
 * `isSessionExpired` is the ONE definition of "the grace elapsed"; both the
 * empty-room close (`isCloseDue`) and the live-room retire share it, so the
 * two clocks cannot drift apart.
 */
import {
  DEFAULT_GRACE_MINUTES,
  graceMs,
  isCloseDue,
  isSessionExpired,
} from './channel-presence-flush.helpers';

const NOW = Date.parse('2026-09-02T18:00:00Z');
const GRACE = 5 * 60_000;

describe('isSessionExpired (ROK-1498)', () => {
  it('is never expired while the room has not been seen empty', () => {
    expect(isSessionExpired(null, GRACE, NOW)).toBe(false);
  });

  it('is not expired one ms inside the grace', () => {
    expect(isSessionExpired(new Date(NOW - GRACE + 1), GRACE, NOW)).toBe(false);
  });

  it('is expired exactly at the grace boundary (same <= as isCloseDue)', () => {
    expect(isSessionExpired(new Date(NOW - GRACE), GRACE, NOW)).toBe(true);
  });

  it('is expired for an empty stretch that outlived the grace overnight', () => {
    expect(isSessionExpired(new Date(NOW - 10 * 60 * 60_000), GRACE, NOW)).toBe(
      true,
    );
  });
});

describe('isCloseDue still requires no live events', () => {
  const expired = new Date(NOW - 60 * 60_000);

  it('holds the row open past the grace while a session is still live', () => {
    expect(isCloseDue(expired, GRACE, NOW, [{ id: 900 }])).toBe(false);
  });

  it('closes once the grace elapsed and nothing is live', () => {
    expect(isCloseDue(expired, GRACE, NOW, [])).toBe(true);
  });

  it('never closes a row that was not seen empty', () => {
    expect(isCloseDue(null, GRACE, NOW, [])).toBe(false);
  });
});

describe('graceMs', () => {
  it('floors a zero grace at one minute', () => {
    expect(graceMs({ gracePeriod: 0 })).toBe(60_000);
  });

  it('defaults to five minutes when the binding sets none', () => {
    expect(graceMs(null)).toBe(DEFAULT_GRACE_MINUTES * 60_000);
  });
});
