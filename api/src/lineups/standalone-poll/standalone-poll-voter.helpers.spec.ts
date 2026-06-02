/**
 * Unit tests for poll-voter DM time formatting (ROK-1112).
 * `formatPollTime` must render the chosen timeslot in the RECIPIENT's
 * timezone — a server-TZ render leaked next-day UTC times to EDT voters.
 */
import { formatPollTime } from './standalone-poll-voter.helpers';

describe('formatPollTime (ROK-1112)', () => {
  // 2026-05-04T01:00:00Z is 9:00 PM EDT on Sun May 3.
  const ISO = '2026-05-04T01:00:00.000Z';

  it('renders the time in the supplied IANA timezone', () => {
    const eastern = formatPollTime(ISO, 'America/New_York');
    expect(eastern).toContain('Sun');
    expect(eastern).toContain('May 3');
    expect(eastern).toContain('9:00');
  });

  it('renders a different wall-clock for a different timezone', () => {
    const pacific = formatPollTime(ISO, 'America/Los_Angeles');
    // 9 PM EDT == 6 PM PDT, still Sun May 3.
    expect(pacific).toContain('Sun');
    expect(pacific).toContain('May 3');
    expect(pacific).toContain('6:00');
  });

  it('renders the next UTC day when formatted in UTC (the original bug)', () => {
    const utc = formatPollTime(ISO, 'UTC');
    expect(utc).toContain('Mon');
    expect(utc).toContain('May 4');
    expect(utc).toContain('1:00');
  });
});
