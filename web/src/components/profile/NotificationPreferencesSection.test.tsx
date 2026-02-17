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
    },
};

describe('NotificationPreferencesSection', () => {
    const mockUpdatePreferences = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
            preferences: mockPreferences,
            isLoading: false,
            updatePreferences: mockUpdatePreferences,
        } as any);
    });

    describe('Loading state', () => {
        it('renders skeleton when loading', () => {
            vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
                preferences: null,
                isLoading: true,
                updatePreferences: mockUpdatePreferences,
            } as any);

            const { container } = render(<NotificationPreferencesSection />);
            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        });

        it('renders skeleton when preferences are not loaded yet', () => {
            vi.spyOn(useNotificationsHook, 'useNotificationPreferences').mockReturnValue({
                preferences: null,
                isLoading: false,
                updatePreferences: mockUpdatePreferences,
            } as any);

            const { container } = render(<NotificationPreferencesSection />);
            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        });
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

        it('renders Discord channel column header', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Discord')).toBeInTheDocument();
        });

        it('renders column headers with responsive width classes', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const headerCells = container.querySelectorAll('.w-10.sm\\:w-12.flex.flex-col');
            expect(headerCells.length).toBe(3);
        });
    });

    describe('Notification type rows', () => {
        it('renders all 7 notification type labels', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('Slot Vacated')).toBeInTheDocument();
            expect(screen.getByText('Event Reminders')).toBeInTheDocument();
            expect(screen.getByText('New Events')).toBeInTheDocument();
            expect(screen.getByText('Subscribed Games')).toBeInTheDocument();
            expect(screen.getByText('Achievements')).toBeInTheDocument();
            expect(screen.getByText('Level Up')).toBeInTheDocument();
            expect(screen.getByText('Missed Event Nudge')).toBeInTheDocument();
        });

        it('renders description for each notification type', () => {
            render(<NotificationPreferencesSection />);
            expect(screen.getByText('When someone leaves a roster slot')).toBeInTheDocument();
            expect(screen.getByText('Reminders for upcoming events')).toBeInTheDocument();
            expect(screen.getByText('When new events are created')).toBeInTheDocument();
        });
    });

    describe('Toggle button responsive sizing (ROK-338)', () => {
        it('toggle buttons have mobile size w-10 h-10', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const toggleButtons = container.querySelectorAll('button[type="button"]');
            expect(toggleButtons.length).toBeGreaterThan(0);
            // All toggle buttons should have w-10 h-10 for mobile (40px)
            toggleButtons.forEach(btn => {
                expect(btn).toHaveClass('w-10');
                expect(btn).toHaveClass('h-10');
            });
        });

        it('toggle buttons reduce to w-8 h-8 on desktop via sm: classes', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const toggleButtons = container.querySelectorAll('button[type="button"]');
            toggleButtons.forEach(btn => {
                expect(btn).toHaveClass('sm:w-8');
                expect(btn).toHaveClass('sm:h-8');
            });
        });

        it('toggle button wrapper has responsive width w-10 sm:w-12', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const wrappers = container.querySelectorAll('.w-10.sm\\:w-12.flex.justify-center');
            expect(wrappers.length).toBeGreaterThan(0);
        });

        it('channel toggle row has responsive gap gap-2 sm:gap-4', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const channelRows = container.querySelectorAll('.flex.gap-2.sm\\:gap-4.shrink-0');
            expect(channelRows.length).toBeGreaterThan(0);
        });
    });

    describe('Toggle states and interaction', () => {
        it('active toggle buttons have emerald styling', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const activeButtons = container.querySelectorAll('button.text-emerald-400');
            expect(activeButtons.length).toBeGreaterThan(0);
        });

        it('inactive toggle buttons have muted text styling', () => {
            const { container } = render(<NotificationPreferencesSection />);
            const inactiveButtons = container.querySelectorAll('button.text-muted');
            expect(inactiveButtons.length).toBeGreaterThan(0);
        });

        it('toggle button has correct aria-label for active toggle', () => {
            render(<NotificationPreferencesSection />);
            // slot_vacated inApp is true → should say "Disable"
            expect(screen.getByLabelText('Disable Slot Vacated inApp notifications')).toBeInTheDocument();
        });

        it('toggle button has correct aria-label for inactive toggle', () => {
            render(<NotificationPreferencesSection />);
            // slot_vacated push is false → should say "Enable"
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
