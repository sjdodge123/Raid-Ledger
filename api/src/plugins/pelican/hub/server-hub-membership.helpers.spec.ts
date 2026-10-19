import {
  SERVER_HUB_WINDOW_DAYS,
  isServerHubMember,
  windowStart,
} from './server-hub-membership.helpers';

const NOW = new Date('2026-10-18T12:00:00Z');
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * 86_400_000);
const row = (o: Partial<Parameters<typeof isServerHubMember>[0]> = {}) => ({
  joinedAt: null,
  leftAt: null,
  lastSeenAt: null,
  ...o,
});

describe('server hub membership window (ROK-1831 L-2)', () => {
  it('is 90 days', () => {
    expect(SERVER_HUB_WINDOW_DAYS).toBe(90);
    expect(windowStart(NOW)).toEqual(daysAgo(90));
  });

  it('counts a sighting 89 days ago and drops one 91 days ago', () => {
    expect(isServerHubMember(row({ lastSeenAt: daysAgo(89) }), NOW)).toBe(true);
    expect(isServerHubMember(row({ lastSeenAt: daysAgo(91) }), NOW)).toBe(
      false,
    );
  });

  it('keeps a manual Join regardless of presence', () => {
    expect(isServerHubMember(row({ joinedAt: daysAgo(200) }), NOW)).toBe(true);
  });

  it('drops a member who left after their last sighting', () => {
    const left = row({ lastSeenAt: daysAgo(5), leftAt: daysAgo(1) });
    expect(isServerHubMember(left, NOW)).toBe(false);
  });

  it('re-adds a member seen again after Leave', () => {
    const back = row({ lastSeenAt: daysAgo(1), leftAt: daysAgo(5) });
    expect(isServerHubMember(back, NOW)).toBe(true);
  });

  it('a never-seen, never-joined row is not a member', () => {
    expect(isServerHubMember(row(), NOW)).toBe(false);
  });
});
