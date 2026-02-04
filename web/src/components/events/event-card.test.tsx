import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventCard, EventCardSkeleton } from './event-card';
import type { EventResponseDto } from '@raid-ledger/contract';

const mockEvent: EventResponseDto = {
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
};

describe('EventCard', () => {
    it('renders event title', () => {
        render(<EventCard event={mockEvent} signupCount={5} />);
        expect(screen.getByText('Test Raid Night')).toBeInTheDocument();
    });

    it('renders signup count', () => {
        render(<EventCard event={mockEvent} signupCount={5} />);
        expect(screen.getByText('5 signed up')).toBeInTheDocument();
    });

    it('renders game name', () => {
        render(<EventCard event={mockEvent} signupCount={0} />);
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('renders creator username', () => {
        render(<EventCard event={mockEvent} signupCount={0} />);
        expect(screen.getByText('by TestUser')).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<EventCard event={mockEvent} signupCount={0} onClick={onClick} />);
        screen.getByText('Test Raid Night').closest('div')?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('EventCardSkeleton', () => {
    it('renders skeleton loader', () => {
        const { container } = render(<EventCardSkeleton />);
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
});
