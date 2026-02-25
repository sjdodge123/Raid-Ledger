/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationPreferencesSection } from './NotificationPreferencesSection';
import * as useNotificationsHook from '../../hooks/use-notifications';

const mockPreferences = {
    channelPrefs: {
        slot_vacated: { inApp: true, push: false, discord: true },
        event_reminder: { inApp: true, push: true, discord: false },
        new_event: { inApp: false, push: false, discord: false },
        subscribed_game: { inApp: true, push: false, discord: false },
        achievement_unlocked: { inApp: false, push: true, discord: true },
        level_up: { inApp: true, push: true, discord: true },
        missed_event_nudge: { inApp: false, push: false, discord: true },
        event_cancelled: { inApp: true, push: true, discord: true },
        event_rescheduled: { inApp: true, push: true, discord: true },
        bench_promoted: { inApp: true, push: true, discord: false },
        roster_reassigned: { inApp: true, push: false, discord: true },
        tentative_displaced: { inApp: false, push: true, discord: true },
    },
};

describe('NotificationPreferencesSection', () => {
    const mockUpdatePreferences = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: Discord available
        vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
            preferences: mockPreferences,
            isLoading: false,
            updatePreferences: mockUpdatePreferences,
            channelAvailability: { discord: { available: true } },
        } as any);
    });

    describe('Section header', () => {
        it('renders the Notifications heading', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Notifications')).toBeInTheDocument();
        });

        it('renders subtitle text', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Choose how and when you get notified')).toBeInTheDocument();
        });
    });

    describe('Column headers', () => {
        it('renders In-App channel column header', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('In-App')).toBeInTheDocument();
        });

        it('renders Push channel column header', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Push')).toBeInTheDocument();
        });

        it('renders Discord channel column header when available', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Discord')).toBeInTheDocument();
        });

        it('hides Discord column when not available (ROK-180 AC-7)', () => {
            vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
                preferences: mockPreferences,
                isLoading: false,
                updatePreferences: mockUpdatePreferences,
                channelAvailability: { discord: { available: false, reason: 'Link your Discord account' } },
            } as any);

            render(<NotificationPreferencesSection />);
            expect(screen.queryByText('Discord')).not.toBeInTheDocument();
        });

        it('shows reason text when Discord is not available (ROK-180 AC-7)', () => {
            vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
                preferences: mockPreferences,
                isLoading: false,
                updatePreferences: mockUpdatePreferences,
                channelAvailability: { discord: { available: false, reason: 'Link your Discord account' } },
            } as any);

            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Link your Discord account')).toBeInTheDocument();
        });

    });

    describe('Notification type rows', () => {
        it('renders all visible notification type labels', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Slot Vacated')).toBeInTheDocument();
            expect(screen.getByText('Event Reminders')).toBeInTheDocument();
            expect(screen.getByText('New Events')).toBeInTheDocument();
            expect(screen.getByText('Subscribed Games')).toBeInTheDocument();
            expect(screen.getByText('Event Cancelled')).toBeInTheDocument();
            expect(screen.getByText('Event Rescheduled')).toBeInTheDocument();
            expect(screen.getByText('Bench Promoted')).toBeInTheDocument();
            expect(screen.getByText('Roster Reassignment')).toBeInTheDocument();
            expect(screen.getByText('Tentative Displaced')).toBeInTheDocument();
        });

        it('does not render missed_event_nudge label (ghost row removed)', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.queryByText('Missed Event Nudge')).not.toBeInTheDocument();
        });

        it('does not render Achievements or Level Up (not yet implemented)', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.queryByText('Achievements')).not.toBeInTheDocument();
            expect(screen.queryByText('Level Up')).not.toBeInTheDocument();
        });

        it('renders description for each notification type', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('When someone leaves a roster slot')).toBeInTheDocument();
            expect(screen.getByText('Reminders for upcoming events')).toBeInTheDocument();
            expect(screen.getByText('When new events are created')).toBeInTheDocument();
            expect(screen.getByText('When an event you signed up for is cancelled')).toBeInTheDocument();
            expect(screen.getByText('When an event you signed up for is rescheduled')).toBeInTheDocument();
            expect(screen.getByText('When you are moved from bench to the active roster')).toBeInTheDocument();
            expect(screen.getByText('When your roster slot or role is changed')).toBeInTheDocument();
            expect(screen.getByText('When a confirmed player takes your tentative slot')).toBeInTheDocument();
        });
    });

    describe('Toggle states and interaction', () => {
        it('toggle button has correct aria-label for active toggle', () => {
            render(<NotificationPreferencesSection />);
            // slot_vacated inApp is true -> should say "Disable"
            expect(screen.getByLabelText('Disable Slot Vacated inApp notifications')).toBeInTheDocument();
        });

        it('toggle button has correct aria-label for inactive toggle', () => {
            render(<NotificationPreferencesSection />);
            // slot_vacated push is false -> should say "Enable"
            expect(screen.getByLabelText('Enable Slot Vacated push notifications')).toBeInTheDocument();
        });

        it('calls updatePreferences when toggle is clicked', () => {
            render(<NotificationPreferencesSection />);
            fireEvent.click(screen.getByLabelText('Disable Slot Vacated inApp notifications'));
            expect(mockUpdatePreferences).toHaveBeenCalledWith({
                channelPrefs: { slot_vacated: { inApp: false } },
            });
        });

        it('calls updatePreferences to enable an inactive toggle', () => {
            render(<NotificationPreferencesSection />);
            fireEvent.click(screen.getByLabelText('Enable Slot Vacated push notifications'));
            expect(mockUpdatePreferences).toHaveBeenCalledWith({
                channelPrefs: { slot_vacated: { push: true } },
            });
        });
    });
});
