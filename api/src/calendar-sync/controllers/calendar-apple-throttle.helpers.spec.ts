/**
 * ROK-1598 D13 — 5 Apple connect attempts per user per 10 minutes.
 */
import {
  APPLE_CONNECT_WINDOW_MS,
  PerUserAttemptWindow,
} from './calendar-apple-throttle.helpers';

const ORIGINAL = process.env.THROTTLE_DISABLED;

beforeEach(() => {
  process.env.THROTTLE_DISABLED = 'false';
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.THROTTLE_DISABLED;
  else process.env.THROTTLE_DISABLED = ORIGINAL;
});

describe('PerUserAttemptWindow', () => {
  it('admits 5 attempts, refuses the 6th, per user', () => {
    const w = new PerUserAttemptWindow();
    const t = 1_000_000;
    const admitted = [0, 1, 2, 3, 4].map((i) => w.tryAttempt(7, t + i));
    expect(admitted).toEqual([true, true, true, true, true]);
    expect(w.tryAttempt(7, t + 5)).toBe(false);
    expect(w.tryAttempt(8, t + 5)).toBe(true);
  });

  it('admits again once the oldest attempt leaves the window', () => {
    const w = new PerUserAttemptWindow();
    const t = 1_000_000;
    for (let i = 0; i < 5; i += 1) w.tryAttempt(7, t + i);
    expect(w.tryAttempt(7, t + APPLE_CONNECT_WINDOW_MS - 1)).toBe(false);
    expect(w.tryAttempt(7, t + APPLE_CONNECT_WINDOW_MS + 1)).toBe(true);
  });

  it('THROTTLE_DISABLED=true admits everything', () => {
    process.env.THROTTLE_DISABLED = 'true';
    const w = new PerUserAttemptWindow(1);
    expect([w.tryAttempt(1, 1), w.tryAttempt(1, 2)]).toEqual([true, true]);
  });
});
