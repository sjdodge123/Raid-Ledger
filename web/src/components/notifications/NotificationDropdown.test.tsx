import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NotificationDropdown } from './NotificationDropdown';
import type { Notification } from '../../hooks/use-notifications';

const mockMarkAllRead = vi.fn();
const mockMarkRead = vi.fn();

// Default: empty notifications, not loading
const mockUseNotifications = vi.fn(() => ({
    notifications: [] as Notification[],
    isLoading: false,
    markAllRead: mockMarkAllRead,
    markRead: mockMarkRead,
    unreadCount: 0,
    error: null,
}));

vi.mock('../../hooks/use-notifications', () => ({
    useNotifications: () => mockUseNotifications(),
}));

const createMockNotification = (overrides: Partial<Notification> = {}): Notification => ({
    id: '1',
    userId: 1,
    type: 'new_event',
    title: 'New Event',
    message: 'A new event has been created',
    createdAt: '2026-02-16T12:00:00Z',
    ...overrides,
});

function renderDropdown(onClose = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <NotificationDropdown onClose={onClose} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { container, onClose };
}

describe('NotificationDropdown — empty state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseNotifications.mockReturnValue({
            notifications: [],
            isLoading: false,
            markAllRead: mockMarkAllRead,
            markRead: mockMarkRead,
            unreadCount: 0,
            error: null,
        });
    });

    it('shows "No notifications" when notification list is empty', () => {
        renderDropdown();
        expect(screen.getByText('No notifications')).toBeInTheDocument();
    });

    it('shows "You\'re all caught up!" message when list is empty', () => {
        renderDropdown();
        expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
    });

    it('does not show "Mark All Read" button when there are no notifications', () => {
        renderDropdown();
        expect(screen.queryByText('Mark All Read')).not.toBeInTheDocument();
    });
});

describe('NotificationDropdown — with notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows "Mark All Read" button when there are notifications', () => {
        mockUseNotifications.mockReturnValueOnce({
            notifications: [createMockNotification()],
            isLoading: false,
            markAllRead: mockMarkAllRead,
            markRead: mockMarkRead,
            unreadCount: 1,
            error: null,
        });
        renderDropdown();
        expect(screen.getByText('Mark All Read')).toBeInTheDocument();
    });

    it('calls markAllRead when "Mark All Read" is clicked', () => {
        mockUseNotifications.mockReturnValueOnce({
            notifications: [createMockNotification()],
            isLoading: false,
            markAllRead: mockMarkAllRead,
            markRead: mockMarkRead,
            unreadCount: 1,
            error: null,
        });
        renderDropdown();
        fireEvent.click(screen.getByText('Mark All Read'));
        expect(mockMarkAllRead).toHaveBeenCalledOnce();
    });
});

describe('NotificationDropdown — header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseNotifications.mockReturnValue({
            notifications: [],
            isLoading: false,
            markAllRead: mockMarkAllRead,
            markRead: mockMarkRead,
            unreadCount: 0,
            error: null,
        });
    });

    it('renders "Notifications" heading', () => {
        renderDropdown();
        expect(screen.getByText('Notifications')).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderDropdown();
        expect(await axe(container)).toHaveNoViolations();
    });

});
