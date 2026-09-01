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
import { MODE_MAP } from './game-card-constants';
import { HeartButton, InfoBar } from './game-card-parts';
import { CardCoverContent, type GameProps } from './unified-game-card-parts';

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

/** Resolve the primary genre label from game data. */
function resolvePrimaryGenre(game: GameProps): string | null {
    return game.genres?.[0] ? GENRE_MAP[game.genres[0]] ?? null : null;
}

/** Heart toggle overlay for link-variant cards. */
function HeartToggleSection({ gameId }: { gameId: number }): JSX.Element | null {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? gameId : undefined,
    );
    if (!isAuthenticated) return null;
    const handleHeart = (e: React.MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (!isToggling) toggle(!wantToPlay);
    };
    return <HeartButton wantToPlay={wantToPlay} count={count} onClick={handleHeart} />;
}

/** Link variant wrapper with heart toggle. */
function LinkCard(props: LinkVariantProps): JSX.Element {
    const { game, compact, pricing, showRating, showInfoBar } = props;
    const rating = resolveRating(game);
    const primaryGenre = resolvePrimaryGenre(game);
    const primaryMode = game.gameModes?.[0]
        ? MODE_MAP[game.gameModes[0]] ?? null
        : null;

    return (
        <Link
            to={`/games/${game.id}`}
            className={buildCardClasses(props)}
            aria-label={game.name}
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
            <HeartToggleSection gameId={game.id} />
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
    const primaryGenre = resolvePrimaryGenre(game);

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
            aria-label={`${selected ? 'Deselect' : 'Select'} ${game.name}`}
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
