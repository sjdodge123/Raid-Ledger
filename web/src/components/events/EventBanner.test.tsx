import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBanner } from './EventBanner';
import { MemoryRouter } from 'react-router-dom';

describe('EventBanner', () => {
    const mockProps = {
        title: 'Mythic+ Push Night',
        game: {
            name: 'World of Warcraft',
            coverUrl: 'https://example.com/wow-cover.jpg',
        },
        startTime: '2026-02-06T13:00:00Z',
        endTime: '2026-02-06T16:00:00Z',
        creator: {
            id: 1,
            username: 'SeedAdmin',
            avatar: 'https://example.com/avatar.png',
        },
    };

    const renderWithRouter = (component: React.ReactNode) => {
        return render(<MemoryRouter>{component}</MemoryRouter>);
    };

    it('renders event title', () => {
        renderWithRouter(<EventBanner {...mockProps} />);
        expect(screen.getByText('Mythic+ Push Night')).toBeInTheDocument();
    });

    it('renders game name with emoji', () => {
        renderWithRouter(<EventBanner {...mockProps} />);
        expect(screen.getByText(/World of Warcraft/)).toBeInTheDocument();
    });

    it('renders creator username as link', () => {
        renderWithRouter(<EventBanner {...mockProps} />);
        const link = screen.getByRole('link', { name: /SeedAdmin/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/users/1');
    });

    it('displays duration correctly for 3 hour event', () => {
        renderWithRouter(<EventBanner {...mockProps} />);
        expect(screen.getByText(/3h/)).toBeInTheDocument();
    });

    it('renders without game when game is null', () => {
        renderWithRouter(<EventBanner {...mockProps} game={null} />);
        expect(screen.getByText('Mythic+ Push Night')).toBeInTheDocument();
        expect(screen.queryByText(/World of Warcraft/)).not.toBeInTheDocument();
    });

    it('renders date and time', () => {
        renderWithRouter(<EventBanner {...mockProps} />);
        // Check for date and time format
        expect(screen.getByText(/@/)).toBeInTheDocument();
    });

    it('applies game cover as background when provided', () => {
        const { container } = renderWithRouter(<EventBanner {...mockProps} />);
        const bgElement = container.querySelector('.event-banner__bg');
        expect(bgElement).toBeInTheDocument();
        expect(bgElement).toHaveStyle({ backgroundImage: 'url(https://example.com/wow-cover.jpg)' });
    });
});
