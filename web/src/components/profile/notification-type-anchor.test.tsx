/**
 * ROK-1797 — `/profile/notifications#notif-<type>`: every type row carries the
 * anchor id, and once preferences load the anchored row is scrolled into view
 * and focused. An anchor with no row is a no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';
import * as useNotificationsHook from '../../hooks/use-notifications';
import { partialResult } from '../../test/partial-result';

vi.mock('./muted-games-list', () => ({ MutedGamesList: () => null }));
vi.mock('./muted-groups-list', () => ({ MutedGroupsList: () => null }));

const scrollIntoView = vi.fn();

function mockPrefs(isLoading: boolean) {
    vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue(
        partialResult<ReturnType<typeof useNotificationsHook.useNotificationPreferences>>({
            preferences: isLoading ? undefined : { userId: 1, channelPrefs: partialResult<useNotificationsHook.ChannelPrefs>({}) },
            isLoading, updatePreferences: vi.fn(), channelAvailability: { discord: { available: true } },
        }),
    );
}

function renderAt(url: string) {
    return render(<MemoryRouter initialEntries={[url]}><NotificationPreferencesSection /></MemoryRouter>);
}

beforeEach(() => {
    vi.restoreAllMocks();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
});

describe('notification type anchors', () => {
    it('gives each type row an #notif-<type> id', () => {
        mockPrefs(false);
        const { container } = renderAt('/profile/notifications');
        expect(container.querySelector('#notif-subscribed_game')).toHaveTextContent('Subscribed Games');
        expect(container.querySelector('#notif-event_reminder')).toHaveTextContent('Event Reminders');
    });

    it('scrolls to and focuses the anchored row once preferences have loaded', () => {
        mockPrefs(false);
        renderAt('/profile/notifications?type=event_reminder#notif-event_reminder');
        const row = screen.getByText('Event Reminders').closest('[id]');
        expect(document.activeElement).toBe(row);
        expect(row).toHaveAttribute('id', 'notif-event_reminder');
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    });

    it('does nothing while the rows are still behind the skeleton', () => {
        mockPrefs(true);
        renderAt('/profile/notifications#notif-event_reminder');
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('ignores an anchor that matches no row', () => {
        mockPrefs(false);
        renderAt('/profile/notifications#notif-not_a_type');
        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.body);
    });
});
