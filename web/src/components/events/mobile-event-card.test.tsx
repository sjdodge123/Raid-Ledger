import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileEventCard, MobileEventCardSkeleton } from './mobile-event-card';
import type { EventResponseDto } from '@raid-ledger/contract';

const MOCK_NOW = new Date('2026-02-10T19:00:00Z');

const createMockEvent = (overrides: Partial<EventResponseDto> = {}): EventResponseDto => ({
    id: 1,
    title: 'Test Raid Night',
    description: 'Weekly raid session',
    startTime: '2026-02-10T20:00:00Z',
    endTime: '2026-02-10T23:00:00Z',
    creator: { id: 1, username: 'TestUser', avatar: null },
    game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: 'https://example.com/cover.jpg' },
    signupCount: 3,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
});

describe('MobileEventCard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders event title', () => {
        render(<MobileEventCard event={createMockEvent()} />);
        expect(screen.getByText('Test Raid Night')).toBeInTheDocument();
    });

    it('renders game name', () => {
        render(<MobileEventCard event={createMockEvent()} />);
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('renders status badge for upcoming events', () => {
        render(<MobileEventCard event={createMockEvent()} />);
        expect(screen.getByTestId('mobile-event-status')).toHaveTextContent('Upcoming');
    });

    it('renders live status badge when event is in progress', () => {
        const liveEvent = createMockEvent({
            startTime: '2026-02-10T18:00:00Z',
            endTime: '2026-02-10T22:00:00Z',
        });
        render(<MobileEventCard event={liveEvent} />);
        expect(screen.getByTestId('mobile-event-status')).toHaveTextContent('Live');
    });

    it('shows signup count', () => {
        render(<MobileEventCard event={createMockEvent()} signupCount={5} />);
        expect(screen.getByTestId('mobile-event-signup-count')).toBeInTheDocument();
    });

    it('fires onClick when card is tapped', () => {
        const onClick = vi.fn();
        render(<MobileEventCard event={createMockEvent()} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('mobile-event-card'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders avatar stack container', () => {
        const event = createMockEvent({
            signupsPreview: [
                { id: 1, discordId: '111', username: 'A', avatar: 'a.png' },
                { id: 2, discordId: '222', username: 'B', avatar: 'b.png' },
                { id: 3, discordId: '333', username: 'C', avatar: 'c.png' },
            ],
        });
        render(<MobileEventCard event={event} signupCount={5} />);
        const avatarStack = screen.getByTestId('mobile-event-avatars');
        expect(avatarStack.children.length).toBe(3);
    });

    it('renders relative time', () => {
        render(<MobileEventCard event={createMockEvent()} />);
        expect(screen.getByTestId('mobile-event-relative')).toBeInTheDocument();
    });
});

