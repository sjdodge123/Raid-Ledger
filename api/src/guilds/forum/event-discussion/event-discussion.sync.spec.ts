/**
 * ROK-2272 S0a — the event thread write window is 1 h after the scheduled
 * end (was 24 h). One deadline drives the RL write gate, the inbound gate and
 * the Discord lock sweep.
 */
import { WRITE_GRACE_MS, writeClosesAtFor } from './event-discussion.sync';

const HOUR = 3_600_000;

describe('writeClosesAtFor (ROK-2272)', () => {
  it('closes writes exactly 1 h after the scheduled end', () => {
    const end = new Date('2026-11-20T20:00:00.000Z');
    expect(writeClosesAtFor(end).toISOString()).toBe(
      '2026-11-20T21:00:00.000Z',
    );
  });

  it('WRITE_GRACE_MS is 1 h, not 24 h', () => {
    expect(WRITE_GRACE_MS).toBe(HOUR);
  });
});
