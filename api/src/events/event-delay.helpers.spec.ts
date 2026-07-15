/**
 * Unit tests for buildDelayMessage (event_delayed notification copy).
 *
 * Regression for the prod report where the delay DM rendered
 * '"D&d night" has been delayed to Jul 15, 1:15 AM UTC (Jul 15, 1:15 AM UTC)'
 * — server-timezone, duplicated — instead of the recipient-local time.
 */
import { buildDelayMessage } from './event-delay.helpers';

describe('buildDelayMessage', () => {
  const newStart = new Date('2026-07-15T01:15:00.000Z');

  it('renders the new start in the recipient timezone', () => {
    const msg = buildDelayMessage(
      'D&d night',
      newStart,
      15,
      'America/New_York',
    );
    expect(msg).toContain('Jul 14');
    expect(msg).toContain('9:15 PM EDT');
  });

  it('includes the delay amount and never emits Discord timestamp markup', () => {
    const msg = buildDelayMessage(
      'D&d night',
      newStart,
      15,
      'America/New_York',
    );
    expect(msg).toContain('delayed by 15 minutes');
    expect(msg).not.toContain('<t:');
  });

  it('renders the time exactly once (no duplicated parenthetical)', () => {
    const msg = buildDelayMessage(
      'D&d night',
      newStart,
      15,
      'America/New_York',
    );
    expect(msg.match(/\d{1,2}:\d{2}/g) ?? []).toHaveLength(1);
  });

  it('falls back to a correctly-labeled UTC rendering', () => {
    const msg = buildDelayMessage('D&d night', newStart, 30, 'UTC');
    expect(msg).toContain('1:15 AM');
    expect(msg).toContain('UTC');
    expect(msg).toContain('delayed by 30 minutes');
  });
});
