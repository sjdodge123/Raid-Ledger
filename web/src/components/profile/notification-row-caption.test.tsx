import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';
import { notificationRowCaption } from './notification-row-caption';
import * as useNotificationsHook from '../../hooks/use-notifications';

vi.mock('./muted-games-list', () => ({ MutedGamesList: () => null }));
vi.mock('./muted-groups-list', () => ({ MutedGroupsList: () => null }));

const ALL = ['inApp', 'push', 'discord'] as const;
const NO_DISCORD = ['inApp', 'push'] as const;

describe('notificationRowCaption (ROK-2290)', () => {
    it('bell off + Discord on reads "Discord DM only"', () => {
        expect(notificationRowCaption({ inApp: false, push: false, discord: true }, ALL)).toBe('Discord DM only');
        expect(notificationRowCaption({ inApp: false, push: true, discord: true }, ALL)).toBe('Discord DM only');
    });

    it('every visible channel off reads "Muted"', () => {
        expect(notificationRowCaption({ inApp: false, push: false, discord: false }, ALL)).toBe('Muted');
        expect(notificationRowCaption(undefined, ALL)).toBe('Muted');
    });

    it('bell on gives no caption', () => {
        expect(notificationRowCaption({ inApp: true, push: false, discord: true }, ALL)).toBeNull();
        expect(notificationRowCaption({ inApp: true, push: false, discord: false }, ALL)).toBeNull();
    });

    it('bell off + push on + Discord off gives no caption', () => {
        expect(notificationRowCaption({ inApp: false, push: true, discord: false }, ALL)).toBeNull();
    });

    it('a hidden Discord column never reads "Discord DM only"', () => {
        expect(notificationRowCaption({ inApp: false, push: false, discord: true }, NO_DISCORD)).toBe('Muted');
        expect(notificationRowCaption({ inApp: false, push: true, discord: true }, NO_DISCORD)).toBeNull();
    });
});

const prefs = {
    channelPrefs: {
        slot_vacated: { inApp: true, push: false, discord: true },
        new_event: { inApp: false, push: false, discord: false },
        valheim_claim_suggestion: { inApp: false, push: false, discord: true },
        tentative_displaced: { inApp: false, push: true, discord: true },
    },
};

function mockHook(discordAvailable: boolean) {
    vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
        preferences: prefs,
        isLoading: false,
        updatePreferences: vi.fn(),
        channelAvailability: { discord: { available: discordAvailable } },
    } as unknown as ReturnType<typeof useNotificationsHook.useNotificationPreferences>);
}

function captionOf(container: HTMLElement, type: string): string | null {
    const row = container.querySelector<HTMLElement>(`#notif-${type}`);
    if (!row) throw new Error(`row #notif-${type} not rendered`);
    return within(row).queryByTestId('notif-row-caption')?.textContent ?? null;
}

function renderSection() {
    return render(<MemoryRouter><NotificationPreferencesSection /></MemoryRouter>);
}

describe('NotificationPreferencesSection captions (ROK-2290)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the hint line under the subtitle', () => {
        mockHook(true);
        renderSection();
        expect(screen.getByTestId('notif-channels-hint')).toHaveTextContent(
            'The bell and Discord switches are separate — turn off the bell and you still get the DM.',
        );
    });

    it('shows the three row states with the Discord column visible', () => {
        mockHook(true);
        const { container } = renderSection();
        expect(captionOf(container, 'slot_vacated')).toBeNull();
        expect(captionOf(container, 'valheim_claim_suggestion')).toBe('Discord DM only');
        expect(captionOf(container, 'tentative_displaced')).toBe('Discord DM only');
        expect(captionOf(container, 'new_event')).toBe('Muted');
    });

    it('shows no "Discord DM only" caption when the Discord column is hidden', () => {
        mockHook(false);
        const { container } = renderSection();
        expect(screen.queryByText('Discord DM only')).not.toBeInTheDocument();
        expect(captionOf(container, 'valheim_claim_suggestion')).toBe('Muted');
        expect(captionOf(container, 'tentative_displaced')).toBeNull();
        expect(captionOf(container, 'slot_vacated')).toBeNull();
    });
});
