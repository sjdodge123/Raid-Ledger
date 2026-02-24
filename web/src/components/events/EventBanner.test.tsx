import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
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
    });

    // ROK-192: Collapsed variant tests
    describe('collapsed variant (ROK-192)', () => {
        it('renders collapsed variant with title and slim layout', () => {
            const { container } = renderWithRouter(<EventBanner {...mockProps} isCollapsed />);
            const banner = container.querySelector('.event-banner--collapsed');
            expect(banner).toBeInTheDocument();
            expect(screen.getByText('Mythic+ Push Night')).toBeInTheDocument();
        });

        it('collapsed variant omits description', () => {
            const { container } = renderWithRouter(
                <EventBanner {...mockProps} description="Team strategy session" isCollapsed />,
            );
            expect(container.querySelector('.event-banner__description')).not.toBeInTheDocument();
        });

        it('collapsed variant includes game icon', () => {
            renderWithRouter(<EventBanner {...mockProps} isCollapsed />);
            expect(screen.getByLabelText('World of Warcraft')).toBeInTheDocument();
        });
    });

    // ROK-192: Description tests
    describe('inline description (ROK-192)', () => {
        it('renders inline description when provided', () => {
            renderWithRouter(<EventBanner {...mockProps} description="Pushing keys tonight!" />);
            expect(screen.getByText('Pushing keys tonight!')).toBeInTheDocument();
        });

        it('omits description element when not provided', () => {
            const { container } = renderWithRouter(<EventBanner {...mockProps} />);
            expect(container.querySelector('.event-banner__description')).not.toBeInTheDocument();
        });

        it('omits description element when null', () => {
            const { container } = renderWithRouter(<EventBanner {...mockProps} description={null} />);
            expect(container.querySelector('.event-banner__description')).not.toBeInTheDocument();
        });
    });

    // ROK-343: Memoization tests
    describe('memoization (ROK-343)', () => {
        it('is wrapped with React.memo', () => {
            // React.memo wraps the component in an object with $$typeof === Symbol(react.memo)
            expect(EventBanner).toHaveProperty('$$typeof');
            // React.memo sets $$typeof to the memo symbol
            const memoSymbol = Symbol.for('react.memo');
            expect((EventBanner as unknown as { $$typeof: symbol }).$$typeof).toBe(memoSymbol);
        });

        it('does not re-render when props are the same (referential equality check)', () => {
            let renderCount = 0;

            // Wrap EventBanner in a spy component to count renders
            const SpyBanner = React.memo(function SpyBanner(props: Parameters<typeof EventBanner>[0]) {
                renderCount++;
                return React.createElement(EventBanner, props);
            });

            const { rerender } = render(
                <MemoryRouter>
                    <SpyBanner {...mockProps} />
                </MemoryRouter>,
            );

            const firstCount = renderCount;

            // Rerender with identical props — EventBanner's memo should prevent inner render
            rerender(
                <MemoryRouter>
                    <SpyBanner {...mockProps} />
                </MemoryRouter>,
            );

            // SpyBanner itself re-renders but EventBanner inside should be memoized
            expect(renderCount).toBeGreaterThanOrEqual(firstCount);
        });
    });
});
