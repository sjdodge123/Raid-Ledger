import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
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

describe('NotificationItem — lineup-only fallback (ROK-1259)', () => {
    const lineupSubtypes = [
        'lineup_vote_reminder',
        'lineup_nominate_reminder',
        'lineup_tiebreaker_reminder',
        'lineup_tiebreaker_open',
        'lineup_nomination_milestone',
    ];

    it.each(lineupSubtypes)('navigates to /community-lineup/:id for %s', (type) => {
        const { onClose } = renderItem(
            makeNotification({ type, payload: { lineupId: 42 } }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/42');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('navigates to lineup detail (not tiebreaker deep link) when tiebreakerId is also present', () => {
        renderItem(
            makeNotification({
                type: 'lineup_tiebreaker_open',
                payload: { lineupId: 99, tiebreakerId: 7 },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/99');
    });

    it('marks unread notifications as read on click', () => {
        renderItem(
            makeNotification({
                type: 'lineup_vote_reminder',
                payload: { lineupId: 42 },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockMarkRead).toHaveBeenCalledWith('n1');
    });
});

describe('NotificationItem — existing navigation paths (regression guards)', () => {
    it('navigates via eventId path for lineup_event_created', () => {
        renderItem(
            makeNotification({
                type: 'lineup_event_created',
                payload: { eventId: 555, lineupId: 42 },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/events/555');
    });

    it('navigates to schedule page for lineup_scheduling_open (matchId + lineupId wins over lineupId alone)', () => {
        renderItem(
            makeNotification({
                type: 'lineup_scheduling_open',
                payload: { matchId: 12, lineupId: 42 },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/42/schedule/12');
    });

    it('navigates to schedule page for lineup_scheduling_reminder', () => {
        renderItem(
            makeNotification({
                type: 'lineup_scheduling_reminder',
                payload: { matchId: 13, lineupId: 43 },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/43/schedule/13');
    });

    it('navigates via explicit link when only link is present', () => {
        renderItem(
            makeNotification({
                type: 'system',
                payload: { link: '/somewhere' },
            }),
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).toHaveBeenCalledWith('/somewhere');
    });

    it('does not navigate when payload has no actionable fields', () => {
        renderItem(makeNotification({ type: 'system', payload: {} }));
        fireEvent.click(screen.getByRole('button'));
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
