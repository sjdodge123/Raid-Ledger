import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NotificationItem } from './NotificationItem';
import type { Notification } from '../../hooks/use-notifications';

const mockNavigate = vi.fn();
const mockMarkRead = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../hooks/use-notifications', async () => {
    const actual = await vi.importActual<typeof import('../../hooks/use-notifications')>('../../hooks/use-notifications');
    return {
        ...actual,
        useNotifications: () => ({
            notifications: [],
            isLoading: false,
            markAllRead: vi.fn(),
            markRead: mockMarkRead,
            unreadCount: 0,
            error: null,
        }),
    };
});

function makeNotification(overrides: Partial<Notification>): Notification {
    return {
        id: 'n1',
        userId: 1,
        type: 'system',
        title: 'Test',
        message: 'Message',
        createdAt: '2026-05-09T12:00:00Z',
        ...overrides,
    };
}

function renderItem(notification: Notification, onClose = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                <NotificationItem notification={notification} onClose={onClose} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { onClose };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// Wire shape: backend sends type 'community_lineup' with the lineup discriminator in
// payload.subtype; handleClick ignores notification.type and dispatches purely on payload
// fields (see api/src/lineups/lineup-reminder-dispatch.helpers.ts).
describe('NotificationItem — lineup-only fallback (ROK-1259)', () => {
    const lineupSubtypes = [
        'lineup_vote_reminder',
        'lineup_nominate_reminder',
        'lineup_tiebreaker_reminder',
        'lineup_tiebreaker_open',
        'lineup_nomination_milestone',
    ];

    it.each(lineupSubtypes)('navigates to /community-lineup/:id for %s', async (subtype) => {
        const user = userEvent.setup();
        const { onClose } = renderItem(
            makeNotification({ type: 'community_lineup', payload: { subtype, lineupId: 42 } }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/42');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('navigates to lineup detail (not tiebreaker deep link) when tiebreakerId is also present', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'community_lineup',
                payload: { subtype: 'lineup_tiebreaker_open', lineupId: 99, tiebreakerId: 7 },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/99');
    });

    it('marks unread notifications as read on click', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'community_lineup',
                payload: { subtype: 'lineup_vote_reminder', lineupId: 42 },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockMarkRead).toHaveBeenCalledWith('n1');
    });
});

describe('NotificationItem — existing navigation paths (regression guards)', () => {
    it('navigates via eventId path for lineup_event_created', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'community_lineup',
                payload: { subtype: 'lineup_event_created', eventId: 555, lineupId: 42 },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/events/555');
    });

    it('navigates to schedule page for lineup_scheduling_open (matchId + lineupId wins over lineupId alone)', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'community_lineup',
                payload: { subtype: 'lineup_scheduling_open', matchId: 12, lineupId: 42 },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/42/schedule/12');
    });

    it('navigates to schedule page for lineup_scheduling_reminder', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'community_lineup',
                // Wire shape matches lineup-reminder-dispatch.helpers.ts, which
                // sends both matchId and lineupId for scheduling reminders.
                payload: { subtype: 'lineup_scheduling_reminder', matchId: 13, lineupId: 43 },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/43/schedule/13');
    });

    it('navigates via explicit link when only link is present', async () => {
        const user = userEvent.setup();
        renderItem(
            makeNotification({
                type: 'system',
                payload: { link: '/somewhere' },
            }),
        );
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/somewhere');
    });

    it('does not navigate and does not close when payload has no actionable fields', async () => {
        const user = userEvent.setup();
        const { onClose } = renderItem(makeNotification({ type: 'system', payload: {} }));
        await user.click(screen.getByRole('button'));
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
