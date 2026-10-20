/**
 * ROK-1832 — the "Group posts" / "Group events" rows on
 * `/profile/notifications`, with the muted-groups list under "Group posts".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as useNotificationsHook from '../../hooks/use-notifications';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';

vi.mock('./muted-games-list', () => ({ MutedGamesList: () => null }));
vi.mock('./muted-groups-list', () => ({ MutedGroupsList: () => <div data-testid="muted-groups-stub" /> }));

beforeEach(() => {
    vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
        preferences: { channelPrefs: { hub_leader_post: { inApp: true, push: true, discord: true } } },
        isLoading: false,
        updatePreferences: vi.fn(),
        channelAvailability: { discord: { available: true } },
    } as unknown as ReturnType<typeof useNotificationsHook.useNotificationPreferences>);
});

describe('NotificationPreferencesSection — group rows', () => {
    it('renders the Group posts and Group events rows', () => {
        render(<MemoryRouter><NotificationPreferencesSection /></MemoryRouter>);
        expect(screen.getByText('Group posts')).toBeInTheDocument();
        expect(screen.getByText('Group events')).toBeInTheDocument();
    });

    it('mounts the muted-groups list once, directly after the Group posts row', () => {
        render(<MemoryRouter><NotificationPreferencesSection /></MemoryRouter>);
        const stubs = screen.getAllByTestId('muted-groups-stub');
        expect(stubs).toHaveLength(1);
        const row = stubs[0]?.parentElement;
        expect(row?.textContent).toContain('Group posts');
        expect(row?.textContent).not.toContain('Group events');
    });
});
