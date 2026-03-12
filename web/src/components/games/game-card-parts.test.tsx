/**
 * Adversarial unit tests for game-card-parts sub-components (ROK-805).
 * Covers CoverImage, CoverPlaceholder, RatingBadge, HeartButton,
 * HeartIcon, GradientOverlay, CardTitle, GenreBadge, InfoBar.
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
    InfoBar,
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

// ── InfoBar ───────────────────────────────────────────────────────────────────

describe('InfoBar — rating display', () => {
    it('does not render star icon when rating is null', () => {
        const { container } = render(
            <InfoBar rating={null} primaryMode={null} />,
        );
        // SVG star is only rendered when rating != null && rating > 0
        expect(container.querySelector('svg')).toBeNull();
    });

    it('does not render star icon when rating is undefined', () => {
        const { container } = render(
            <InfoBar rating={undefined} primaryMode={null} />,
        );
        expect(container.querySelector('svg')).toBeNull();
    });

    it('does not render star icon when rating is 0', () => {
        const { container } = render(
            <InfoBar rating={0} primaryMode={null} />,
        );
        expect(container.querySelector('svg')).toBeNull();
    });

    it('renders the rounded rating when rating is a positive number', () => {
        render(<InfoBar rating={87.4} primaryMode={null} />);
        expect(screen.getByText('87')).toBeInTheDocument();
    });

    it('renders rating of 1 (minimum positive)', () => {
        render(<InfoBar rating={1} primaryMode={null} />);
        expect(screen.getByText('1')).toBeInTheDocument();
    });
});

describe('InfoBar — primaryMode display', () => {
    it('does not render mode when primaryMode is null', () => {
        render(<InfoBar rating={null} primaryMode={null} />);
        expect(screen.queryByText('Single')).not.toBeInTheDocument();
    });

    it('renders mode text when primaryMode is provided', () => {
        render(<InfoBar rating={null} primaryMode="Co-op" />);
        expect(screen.getByText('Co-op')).toBeInTheDocument();
    });

    it('renders dot separator only when primaryMode is present and rating > 0', () => {
        const { container } = render(
            <InfoBar rating={80} primaryMode="Multi" />,
        );
        // The &middot; renders as a text node
        expect(container.textContent).toContain('·');
    });

    it('renders dot separator even when rating is null but mode is shown', () => {
        // The middot is always rendered alongside primaryMode — it's a visual
        // separator between the rating section and the mode section.
        // When rating is null, the separator appears as the first item.
        const { container } = render(
            <InfoBar rating={null} primaryMode="Single" />,
        );
        // The dot is always present when primaryMode is set
        expect(container.textContent).toContain('·');
    });
});
