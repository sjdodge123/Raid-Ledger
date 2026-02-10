import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventCard, EventCardSkeleton } from './event-card';
import { getEventStatus, getRelativeTime } from '../../lib/event-utils';
import type { EventResponseDto } from '@raid-ledger/contract';

// Mock current date for consistent testing
const MOCK_NOW = new Date('2026-02-10T19:00:00Z');

const createMockEvent = (overrides: Partial<EventResponseDto> = {}): EventResponseDto => ({
    id: 1,
    title: 'Test Raid Night',
    description: 'Weekly raid session',
    startTime: '2026-02-10T20:00:00Z',
    endTime: '2026-02-10T23:00:00Z',
    creator: { id: 1, username: 'TestUser', avatar: null },
    game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: 'https://example.com/cover.jpg' },
    signupCount: 3,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
});

describe('getEventStatus', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns upcoming for future events', () => {
        expect(getEventStatus('2026-02-10T21:00:00Z', '2026-02-10T23:00:00Z')).toBe('upcoming');
    });

    it('returns live for in-progress events', () => {
        expect(getEventStatus('2026-02-10T18:00:00Z', '2026-02-10T22:00:00Z')).toBe('live');
    });

    it('returns ended for past events', () => {
        expect(getEventStatus('2026-02-10T15:00:00Z', '2026-02-10T18:00:00Z')).toBe('ended');
    });
});

describe('getRelativeTime', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns relative time for upcoming event', () => {
        const result = getRelativeTime('2026-02-10T20:00:00Z', '2026-02-10T23:00:00Z');
        expect(result).toMatch(/in 1 hour/i);
    });

    it('returns started time for live event', () => {
        const result = getRelativeTime('2026-02-10T18:00:00Z', '2026-02-10T22:00:00Z');
        expect(result).toMatch(/started.*ago/i);
    });

    it('returns ended time for past event', () => {
        const result = getRelativeTime('2026-02-10T15:00:00Z', '2026-02-10T17:00:00Z');
        expect(result).toMatch(/ended.*ago/i);
    });
});

describe('EventCard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders event title', () => {
        render(<EventCard event={createMockEvent()} signupCount={5} />);
        expect(screen.getByText('Test Raid Night')).toBeInTheDocument();
    });

    it('renders signup count', () => {
        render(<EventCard event={createMockEvent()} signupCount={5} />);
        expect(screen.getByText('5 signed up')).toBeInTheDocument();
    });

    it('renders game name', () => {
        render(<EventCard event={createMockEvent()} signupCount={0} />);
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('renders creator username', () => {
        render(<EventCard event={createMockEvent()} signupCount={0} />);
        expect(screen.getByText('by TestUser')).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<EventCard event={createMockEvent()} signupCount={0} onClick={onClick} />);
        screen.getByText('Test Raid Night').closest('div')?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders upcoming status badge for future events', () => {
        render(<EventCard event={createMockEvent()} signupCount={0} />);
        expect(screen.getByTestId('event-status-badge')).toHaveTextContent('Upcoming');
    });

    it('renders live status badge when event is in progress', () => {
        const liveEvent = createMockEvent({
            startTime: '2026-02-10T18:00:00Z',
            endTime: '2026-02-10T22:00:00Z',
        });
        render(<EventCard event={liveEvent} signupCount={0} />);
        expect(screen.getByTestId('event-status-badge')).toHaveTextContent('Live');
    });

    it('renders ended status badge for past events', () => {
        const pastEvent = createMockEvent({
            startTime: '2026-02-10T15:00:00Z',
            endTime: '2026-02-10T17:00:00Z',
        });
        render(<EventCard event={pastEvent} signupCount={0} />);
        expect(screen.getByTestId('event-status-badge')).toHaveTextContent('Ended');
    });

    it('renders relative time for event', () => {
        render(<EventCard event={createMockEvent()} signupCount={0} />);
        expect(screen.getByTestId('relative-time')).toBeInTheDocument();
    });
});

describe('EventCardSkeleton', () => {
    it('renders skeleton loader', () => {
        const { container } = render(<EventCardSkeleton />);
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders skeleton badge placeholder', () => {
        const { container } = render(<EventCardSkeleton />);
        const badgeSkeleton = container.querySelector('.rounded-full.bg-overlay');
        expect(badgeSkeleton).toBeInTheDocument();
    });
});

