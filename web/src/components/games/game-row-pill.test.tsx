/**
 * Unit tests for GameRowPill component (ROK-805).
 * Tests name display, cover image, link vs div, and subtitle.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameRowPill } from './game-row-pill';

function renderPill(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('GameRowPill — basic rendering', () => {
    it('renders the game name', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
            />,
        );
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });

    it('renders cover image when coverUrl is provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl="https://example.com/cover.jpg"
            />,
        );
        const img = screen.getByAltText('Elden Ring');
        expect(img).toHaveAttribute(
            'src',
            'https://example.com/cover.jpg',
        );
    });

    it('renders placeholder when coverUrl is null', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
            />,
        );
        expect(screen.queryByAltText('Elden Ring')).not.toBeInTheDocument();
        expect(screen.getByText('?')).toBeInTheDocument();
    });
});

describe('GameRowPill — link behavior', () => {
    it('renders as a Link when href is provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
                href="/games/1"
            />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/games/1');
    });

    it('renders as a div when href is not provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
            />,
        );
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('GameRowPill — subtitle', () => {
    it('renders subtitle when provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
                subtitle="120h 30m"
            />,
        );
        expect(screen.getByText('120h 30m')).toBeInTheDocument();
    });

    it('does not render subtitle area when not provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl={null}
            />,
        );
        expect(screen.queryByText(/\d+h/)).not.toBeInTheDocument();
    });
});
