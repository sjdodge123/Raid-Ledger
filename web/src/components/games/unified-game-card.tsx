/**
 * Unified tall game card component (ROK-805).
 * Replaces GameCard, MobileGameCard, OnboardingGameCard, and WatchedGameCard
 * with a single variant-based component.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';
import { GENRE_MAP } from '../../lib/game-utils';
import { PriceBadge } from './PriceBadge';
import { MODE_MAP } from './game-card-constants';
import {
    CoverImage,
    CoverPlaceholder,
    RatingBadge,
    GradientOverlay,
    CardTitle,
    GenreBadge,
    HeartButton,
    HeartIcon,
    InfoBar,
} from './game-card-parts';

/** Minimal game shape accepted by UnifiedGameCard. */
interface GameProps {
    id: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    genres?: number[];
    aggregatedRating?: number | null;
    rating?: number | null;
    gameModes?: number[];
}

/** Props shared by both variants. */
interface BaseProps {
    game: GameProps;
    compact?: boolean;
    pricing?: ItadGamePricingDto | null;
    showRating?: boolean;
    showInfoBar?: boolean;
    dimWhenInactive?: boolean;
}

/** Link variant navigates to game detail page. */
interface LinkVariantProps extends BaseProps {
    variant: 'link';
    selected?: never;
    onToggle?: never;
}

/** Toggle variant fires onToggle callback. */
interface ToggleVariantProps extends BaseProps {
    variant: 'toggle';
    selected: boolean;
    onToggle: () => void;
}

export type UnifiedGameCardProps = LinkVariantProps | ToggleVariantProps;

/** Resolve the effective rating from game data. */
function resolveRating(game: GameProps): number | null {
    const r = game.aggregatedRating ?? game.rating ?? null;
    return r && r > 0 ? r : null;
}

/** Build the outer className for the card. */
function buildCardClasses(props: UnifiedGameCardProps): string {
    const { compact, variant, dimWhenInactive } = props;
    const base =
        'group block relative rounded-xl overflow-hidden bg-panel transition-all';
    const sizing = compact ? 'w-[180px] flex-shrink-0' : '';
    const hover = 'hover:shadow-lg hover:shadow-emerald-900/20';
    if (variant === 'toggle') {
        const selected = props.selected;
        const dim = dimWhenInactive && !selected ? 'opacity-50' : '';
        const border = selected
            ? 'border-2 border-emerald-500 shadow-emerald-500/20 shadow-md'
            : 'border-2 border-edge/50 hover:border-emerald-500/50';
        return `${base} ${border} cursor-pointer ${hover} ${dim} ${sizing}`.trim();
    }
    return `${base} border border-edge/50 hover:border-emerald-500/50 ${hover} ${sizing}`.trim();
}

/** Inner content: cover image, overlays, badges. */
function CardCoverContent({
    game,
    rating,
    showRating,
    primaryGenre,
    pricing,
    variant,
    selected,
}: {
    game: GameProps;
    rating: number | null;
    showRating: boolean;
    primaryGenre: string | null;
    pricing: ItadGamePricingDto | null | undefined;
    variant: 'link' | 'toggle';
    selected: boolean;
}): JSX.Element {
    return (
        <div className="relative aspect-[3/4] bg-panel">
            {game.coverUrl ? (
                <CoverImage src={game.coverUrl} alt={game.name} />
            ) : (
                <CoverPlaceholder />
            )}
            {showRating && rating != null && <RatingBadge rating={rating} />}
            <GradientOverlay />
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <CardTitle name={game.name} />
                <div className="flex items-center gap-1.5 mt-1">
                    {primaryGenre && <GenreBadge label={primaryGenre} />}
                    <PriceBadge pricing={pricing ?? null} />
                </div>
            </div>
            {variant === 'toggle' && <HeartIcon selected={selected} />}
        </div>
    );
}

/** Link variant wrapper with heart toggle. */
function LinkCard(props: LinkVariantProps): JSX.Element {
    const { game, compact, pricing, showRating, showInfoBar } = props;
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );
    const rating = resolveRating(game);
    const primaryGenre = game.genres?.[0]
        ? GENRE_MAP[game.genres[0]] ?? null
        : null;
    const primaryMode = game.gameModes?.[0]
        ? MODE_MAP[game.gameModes[0]] ?? null
        : null;

    const handleHeart = (e: React.MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (!isToggling && isAuthenticated) toggle(!wantToPlay);
    };

    return (
        <Link
            to={`/games/${game.id}`}
            className={buildCardClasses(props)}
        >
            <CardCoverContent
                game={game}
                rating={rating}
                showRating={showRating ?? false}
                primaryGenre={primaryGenre}
                pricing={pricing}
                variant="link"
                selected={false}
            />
            {isAuthenticated && (
                <HeartButton
                    wantToPlay={wantToPlay}
                    count={count}
                    onClick={handleHeart}
                />
            )}
            {showInfoBar && !compact && (
                <InfoBar rating={rating} primaryMode={primaryMode} />
            )}
        </Link>
    );
}

/** Toggle variant wrapper with controlled selection. */
function ToggleCard(props: ToggleVariantProps): JSX.Element {
    const { game, pricing, showRating, selected, onToggle } = props;
    const rating = resolveRating(game);
    const primaryGenre = game.genres?.[0]
        ? GENRE_MAP[game.genres[0]] ?? null
        : null;

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onToggle}
            onKeyDown={handleKeyDown}
            className={buildCardClasses(props)}
        >
            <CardCoverContent
                game={game}
                rating={rating}
                showRating={showRating ?? false}
                primaryGenre={primaryGenre}
                pricing={pricing}
                variant="toggle"
                selected={selected}
            />
        </div>
    );
}

/**
 * Unified game card with two variants:
 * - `link`: navigates to game detail page with heart toggle
 * - `toggle`: div-based with controlled selected/onToggle
 */
export function UnifiedGameCard(props: UnifiedGameCardProps): JSX.Element {
    if (props.variant === 'toggle') return <ToggleCard {...props} />;
    return <LinkCard {...props} />;
}
