import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ActivityFeed } from './activity-feed';

// event_reminder is one of the EVENT_TYPES the feed shows; a <t:>-bearing
// message here proves the activity-feed render path localizes tokens (ROK-1403
// defense in depth — this call site was previously untested).
vi.mock('../../hooks/use-notifications', () => ({
  useNotifications: () => ({
    notifications: [
      {
        id: 'a1',
        userId: 1,
        type: 'event_reminder',
        title: 'Event Reminder',
        message: 'Raid Night starts <t:1700000000:f> (<t:1700000000:R>)',
        createdAt: '2026-07-15T12:00:00Z',
      },
    ],
    isLoading: false,
  }),
}));

describe('ActivityFeed — Discord timestamp rendering (ROK-1403)', () => {
  it('renders <t:> markup as a localized <time>, not raw tokens', () => {
    const { container } = render(<ActivityFeed />);
    expect(container.textContent).not.toContain('<t:');
    expect(container.querySelector('time')).not.toBeNull();
  });
});
