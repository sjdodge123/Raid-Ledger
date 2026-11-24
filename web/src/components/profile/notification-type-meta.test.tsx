/**
 * ROK-2311 — the grouped notification matrix on `/profile/notifications`: seven headings,
 * the relabelled invites row, the split + switchless rows, and rows that hide switches.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as useNotificationsHook from '../../hooks/use-notifications';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';

vi.mock('./muted-games-list', () => ({ MutedGamesList: () => null }));
vi.mock('./muted-groups-list', () => ({ MutedGroupsList: () => null }));

function renderSection(discordAvailable = true) {
    vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
        preferences: { channelPrefs: {} },
        isLoading: false,
        updatePreferences: vi.fn(),
        channelAvailability: { discord: { available: discordAvailable } },
    } as unknown as ReturnType<typeof useNotificationsHook.useNotificationPreferences>);
    return render(<MemoryRouter><NotificationPreferencesSection /></MemoryRouter>);
}

function rowOf(container: HTMLElement, type: string): HTMLElement {
    const row = container.querySelector<HTMLElement>(`#notif-${type}`);
    if (!row) throw new Error(`row #notif-${type} not rendered`);
    return row;
}

function labelsIn(heading: string): string[] {
    const region = screen.getByRole('region', { name: heading });
    return Array.from(region.querySelectorAll('[id^="notif-"] .font-medium'), (el) => el.textContent ?? '');
}

describe('notification matrix groups (ROK-2311)', () => {
    it('renders the seven headings in the approved order', () => {
        renderSection();
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual(['Events', 'Your roster spot', 'Organizer', 'Games & groups', 'Lineups & polls', 'LFG', 'Other']);
    });

    it('relabels new_event as "Event invites" with the approved caption', () => {
        const { container } = renderSection();
        const row = rowOf(container, 'new_event');
        expect(row).toHaveTextContent('Event invites');
        expect(row).toHaveTextContent('Someone invites you or one of your characters to an event');
        expect(screen.queryByText('New Events')).not.toBeInTheDocument();
    });

    it('puts the mockup rows under their headings, in mockup order', () => {
        renderSection();
        expect(labelsIn('Events').slice(0, 6)).toEqual([
            'Event Reminders', 'Event invites', 'Event Cancelled', 'Event Rescheduled', 'Event delayed', 'Running late',
        ]);
        expect(labelsIn('Your roster spot').slice(0, 3)).toEqual(['Bench Promoted', 'Roster Reassignment', 'Voice access removed']);
        expect(labelsIn('Organizer').slice(0, 4)).toEqual(['Slot Vacated', 'No-show alerts', 'Spots available', 'Role gaps']);
        expect(labelsIn('Lineups & polls').slice(0, 3)).toEqual(['Community Lineup', 'Scheduling polls', 'LFG offers after a lineup']);
        expect(labelsIn('Lineups & polls')).toContain('Steam link nudges');
    });

    it('gives each new type its own row', () => {
        const { container } = renderSection();
        for (const type of ['scheduling_poll', 'lineup_lfg_offer', 'voice_access_lost', 'event_delayed', 'running_late',
            'missed_event_nudge', 'recruitment_reminder', 'role_gap_alert', 'lineup_steam_nudge']) {
            expect(container.querySelector(`#notif-${type}`), type).not.toBeNull();
        }
    });
});

describe('rows that offer fewer channels (ROK-2311)', () => {
    it('the in-app-only LFG-offers row shows only the bell switch', () => {
        const { container } = renderSection();
        const row = rowOf(container, 'lineup_lfg_offer');
        expect(within(row).getAllByRole('button')).toHaveLength(1);
        expect(within(row).getByRole('button')).toHaveAccessibleName(/In-App notifications$/);
        expect(within(row).getByTestId('notif-not-offered-push')).toBeInTheDocument();
        expect(within(row).getByTestId('notif-not-offered-discord')).toBeInTheDocument();
    });

    it('the DM-only claim-suggestion row hides the bell and Push switches', () => {
        const { container } = renderSection();
        const row = rowOf(container, 'valheim_claim_suggestion');
        expect(within(row).queryByRole('button', { name: /In-App notifications$/ })).toBeNull();
        expect(within(row).queryByRole('button', { name: /Push notifications$/ })).toBeNull();
        expect(within(row).getByTestId('notif-not-offered-inApp')).toBeInTheDocument();
        expect(within(row).getByTestId('notif-not-offered-push')).toBeInTheDocument();
        expect(within(row).getAllByRole('button')).toHaveLength(1);
        expect(within(row).getByRole('button', { name: /Discord notifications$/ })).toBeInTheDocument();
    });

    it('the DM-only row offers no switch at all when the Discord column is hidden', () => {
        const { container } = renderSection(false);
        expect(within(rowOf(container, 'valheim_claim_suggestion')).queryAllByRole('button')).toHaveLength(0);
    });

    it('a not-offered cell names its column for screen readers, not the raw channel key', () => {
        const { container } = renderSection();
        const row = rowOf(container, 'lineup_lfg_offer');
        expect(within(row).getByTestId('notif-not-offered-push')).toHaveTextContent('Not sent by Push');
        expect(within(row).getByTestId('notif-not-offered-discord')).toHaveTextContent('Not sent by Discord');
        const dmRow = rowOf(container, 'valheim_claim_suggestion');
        expect(within(dmRow).getByTestId('notif-not-offered-inApp')).toHaveTextContent('Not sent by In-App');
    });

    it('a normal row still shows all three switches', () => {
        const { container } = renderSection();
        expect(within(rowOf(container, 'slot_vacated')).getAllByRole('button')).toHaveLength(3);
    });
});
