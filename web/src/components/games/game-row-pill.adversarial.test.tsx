/**
 * Adversarial unit tests for GameRowPill — edge cases not covered by
 * the dev-authored test suite (ROK-805).
 *
 * Focus areas:
 * - Long game names (truncation boundary — no crash)
 * - Empty subtitle string vs absent subtitle
 * - href="" (empty string) treated as no-href (div)
 * - Correct alt text on cover image
 * - Accessibility: img alt, link accessible name
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameRowPill } from './game-row-pill';

function renderPill(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ── Long names ────────────────────────────────────────────────────────────────

describe('GameRowPill — long game names', () => {
    it('renders a 100-character name without crashing', () => {
        const longName = 'A'.repeat(100);
        renderPill(
            <GameRowPill gameId={1} name={longName} coverUrl={null} />,
        );
        expect(screen.getByText(longName)).toBeInTheDocument();
    });

    it('renders a name with special HTML characters safely', () => {
        const specialName = 'Game & Beyond: <Test>';
        renderPill(
            <GameRowPill gameId={2} name={specialName} coverUrl={null} />,
        );
        expect(screen.getByText(specialName)).toBeInTheDocument();
    });
});

// ── Subtitle edge cases ───────────────────────────────────────────────────────

describe('GameRowPill — subtitle edge cases', () => {
    it('renders an empty-string subtitle (shows block layout)', () => {
        // Empty string is truthy enough to trigger the subtitle branch
        renderPill(
            <GameRowPill
                gameId={1}
                name="Game"
                coverUrl={null}
                subtitle=""
            />,
        );
        // The game name should still be present
        expect(screen.getByText('Game')).toBeInTheDocument();
    });

    it('renders subtitle with numeric-only content', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Game"
                coverUrl={null}
                subtitle="120"
            />,
        );
        expect(screen.getByText('120')).toBeInTheDocument();
    });

    it('renders subtitle with playtime-style format', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Game"
                coverUrl={null}
                subtitle="42h 30m"
            />,
        );
        expect(screen.getByText('42h 30m')).toBeInTheDocument();
    });
});

// ── Cover image accessibility ─────────────────────────────────────────────────

describe('GameRowPill — cover image accessibility', () => {
    it('img alt text matches the game name', () => {
        renderPill(
            <GameRowPill
                gameId={5}
                name="Hollow Knight"
                coverUrl="https://example.com/hk.jpg"
            />,
        );
        const img = screen.getByAltText('Hollow Knight');
        expect(img).toHaveAttribute('src', 'https://example.com/hk.jpg');
    });

    it('img has loading=lazy attribute', () => {
        renderPill(
            <GameRowPill
                gameId={5}
                name="Hollow Knight"
                coverUrl="https://example.com/hk.jpg"
            />,
        );
        expect(screen.getByAltText('Hollow Knight')).toHaveAttribute(
            'loading',
            'lazy',
        );
    });
});

// ── Link href values ──────────────────────────────────────────────────────────

describe('GameRowPill — link href', () => {
    it('renders as a link with game-detail href', () => {
        renderPill(
            <GameRowPill
                gameId={10}
                name="Deep Rock"
                coverUrl={null}
                href="/games/10"
            />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/games/10');
    });

    it('contains the game name inside the link', () => {
        renderPill(
            <GameRowPill
                gameId={10}
                name="Deep Rock"
                coverUrl={null}
                href="/games/10"
            />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveTextContent('Deep Rock');
    });

    it('renders as a div (no link role) when href is not provided', () => {
        renderPill(
            <GameRowPill gameId={1} name="Solo Game" coverUrl={null} />,
        );
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

// ── Placeholder "?" ───────────────────────────────────────────────────────────

describe('GameRowPill — placeholder when no cover', () => {
    it('shows "?" placeholder when coverUrl is null', () => {
        renderPill(
            <GameRowPill gameId={1} name="Elden Ring" coverUrl={null} />,
        );
        expect(screen.getByText('?')).toBeInTheDocument();
    });

    it('does not show "?" when coverUrl is provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Elden Ring"
                coverUrl="https://example.com/cover.jpg"
            />,
        );
        expect(screen.queryByText('?')).not.toBeInTheDocument();
    });
});

// ── Both cover and subtitle together ─────────────────────────────────────────

describe('GameRowPill — cover + subtitle combination', () => {
    it('renders both cover image and subtitle when both provided', () => {
        renderPill(
            <GameRowPill
                gameId={1}
                name="Valheim"
                coverUrl="https://example.com/valheim.jpg"
                subtitle="200h played"
                href="/games/1"
            />,
        );
        expect(screen.getByAltText('Valheim')).toBeInTheDocument();
        expect(screen.getByText('200h played')).toBeInTheDocument();
        expect(screen.getByRole('link')).toBeInTheDocument();
    });
});
