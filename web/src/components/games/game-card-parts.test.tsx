/**
 * Adversarial unit tests for game-card-parts sub-components (ROK-805).
 * Covers CoverImage, CoverPlaceholder, RatingBadge, HeartButton,
 * HeartIcon, GradientOverlay, CardTitle, GenreBadge.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    CoverImage,
    CoverPlaceholder,
    RatingBadge,
    HeartButton,
    HeartIcon,
    GradientOverlay,
    CardTitle,
    GenreBadge,
} from './game-card-parts';

// ── CoverImage ────────────────────────────────────────────────────────────────

describe('CoverImage', () => {
    it('renders img with correct src and alt', () => {
        render(
            <CoverImage src="https://example.com/img.jpg" alt="Elden Ring" />,
        );
        const img = screen.getByAltText('Elden Ring');
        expect(img).toHaveAttribute('src', 'https://example.com/img.jpg');
    });

    it('has loading=lazy for performance', () => {
        render(<CoverImage src="https://example.com/img.jpg" alt="Game" />);
        expect(screen.getByAltText('Game')).toHaveAttribute(
            'loading',
            'lazy',
        );
    });

    it('renders with empty string alt when provided', () => {
        const { container } = render(
            <CoverImage src="https://example.com/img.jpg" alt="" />,
        );
        const img = container.querySelector('img');
        expect(img).toHaveAttribute('alt', '');
    });
});

// ── CoverPlaceholder ──────────────────────────────────────────────────────────

describe('CoverPlaceholder', () => {
    it('renders without crashing', () => {
        const { container } = render(<CoverPlaceholder />);
        expect(container.firstChild).not.toBeNull();
    });

    it('does not render any img element', () => {
        const { container } = render(<CoverPlaceholder />);
        expect(container.querySelector('img')).toBeNull();
    });

    it('renders an svg icon', () => {
        const { container } = render(<CoverPlaceholder />);
        expect(container.querySelector('svg')).not.toBeNull();
    });
});

// ── RatingBadge ───────────────────────────────────────────────────────────────

describe('RatingBadge', () => {
    it('renders the rounded rating value', () => {
        render(<RatingBadge rating={85.6} />);
        expect(screen.getByText('86')).toBeInTheDocument();
    });

    it('rounds down correctly', () => {
        render(<RatingBadge rating={85.4} />);
        expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('has accessible aria-label with rounded rating', () => {
        render(<RatingBadge rating={92.3} />);
        const badge = screen.getByLabelText('Rating 92');
        expect(badge).toBeInTheDocument();
    });

    it('renders rating of 0 as 0', () => {
        render(<RatingBadge rating={0} />);
        expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('renders rating of 100', () => {
        render(<RatingBadge rating={100} />);
        expect(screen.getByText('100')).toBeInTheDocument();
    });
});

// ── HeartButton ───────────────────────────────────────────────────────────────

describe('HeartButton', () => {
    it('has "Add to want to play" label when wantToPlay is false', () => {
        render(
            <HeartButton wantToPlay={false} count={0} onClick={vi.fn()} />,
        );
        expect(
            screen.getByRole('button', { name: /add to want to play/i }),
        ).toBeInTheDocument();
    });

    it('has "Remove from want to play" label when wantToPlay is true', () => {
        render(
            <HeartButton wantToPlay={true} count={5} onClick={vi.fn()} />,
        );
        expect(
            screen.getByRole('button', {
                name: /remove from want to play/i,
            }),
        ).toBeInTheDocument();
    });

    it('does not render count badge when count is 0', () => {
        render(
            <HeartButton wantToPlay={false} count={0} onClick={vi.fn()} />,
        );
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('renders count badge when count is greater than 0', () => {
        render(
            <HeartButton wantToPlay={true} count={3} onClick={vi.fn()} />,
        );
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders count badge for count of 1', () => {
        render(
            <HeartButton wantToPlay={true} count={1} onClick={vi.fn()} />,
        );
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('calls onClick when clicked', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(
            <HeartButton wantToPlay={false} count={0} onClick={onClick} />,
        );
        await user.click(
            screen.getByRole('button', { name: /add to want to play/i }),
        );
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders high count badge (e.g. 99)', () => {
        render(
            <HeartButton wantToPlay={true} count={99} onClick={vi.fn()} />,
        );
        expect(screen.getByText('99')).toBeInTheDocument();
    });
});

// ── HeartIcon ────────────────────────────────────────────────────────────────

describe('HeartIcon', () => {
    it('renders without crashing when selected is true', () => {
        const { container } = render(<HeartIcon selected={true} />);
        expect(container.firstChild).not.toBeNull();
    });

    it('renders without crashing when selected is false', () => {
        const { container } = render(<HeartIcon selected={false} />);
        expect(container.firstChild).not.toBeNull();
    });

    it('is not an interactive button (non-interactive overlay)', () => {
        const { container } = render(<HeartIcon selected={false} />);
        expect(container.querySelector('button')).toBeNull();
    });

    it('renders an svg icon', () => {
        const { container } = render(<HeartIcon selected={false} />);
        expect(container.querySelector('svg')).not.toBeNull();
    });
});

// ── GradientOverlay ───────────────────────────────────────────────────────────

describe('GradientOverlay', () => {
    it('renders without crashing', () => {
        const { container } = render(<GradientOverlay />);
        expect(container.firstChild).not.toBeNull();
    });

    it('does not render any visible text', () => {
        const { container } = render(<GradientOverlay />);
        expect(container.textContent).toBe('');
    });
});

// ── CardTitle ─────────────────────────────────────────────────────────────────

describe('CardTitle', () => {
    it('renders the game name as an h3', () => {
        render(<CardTitle name="Elden Ring" />);
        const heading = screen.getByRole('heading', { level: 3 });
        expect(heading).toHaveTextContent('Elden Ring');
    });

    it('renders a very long name without crashing', () => {
        const longName = 'A'.repeat(200);
        render(<CardTitle name={longName} />);
        expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    });

    it('renders empty string without crashing', () => {
        render(<CardTitle name="" />);
        expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    });
});

// ── GenreBadge ────────────────────────────────────────────────────────────────

describe('GenreBadge', () => {
    it('renders the label text', () => {
        render(<GenreBadge label="RPG" />);
        expect(screen.getByText('RPG')).toBeInTheDocument();
    });

    it('renders in a span element', () => {
        const { container } = render(<GenreBadge label="Shooter" />);
        expect(container.querySelector('span')).not.toBeNull();
    });

    it('renders an empty label without crashing', () => {
        render(<GenreBadge label="" />);
        // Should render without throwing
        expect(document.body).toBeInTheDocument();
    });
});

// ── InfoBar DELETED (ROK-1314, operator decision 2026-09-01) ────────────────
// The InfoBar and all of its tests are gone. It had stopped carrying anything
// unique: its star rating DUPLICATED the RatingBadge already on the cover (both
// flags were passed together on every call site), its `primaryMode` label was
// `MODE_MAP[gameModes[0]]` — IGDB stores modes in ascending id order, so it read
// "Single" for any game with a single-player component, labelling Rocket League
// `Single` beside `1-8 players` and `4 local co-op` — and its co-op badge had
// already moved to the shared CoopPill.
// Nothing was lost: rating is covered by the RatingBadge tests below, and how a
// game is played is now carried by the player-count badge and the co-op pill,
// both from better sources than a mode id.
