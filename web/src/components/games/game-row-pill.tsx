/**
 * Shared row pill component for game lists (ROK-805).
 * Replaces HeartedGameCard, WishlistCard, and SteamLibraryCard.
 * Renders as a Link when href is provided, otherwise as a div.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { PriceBadge } from './PriceBadge';
import { YouOwnBadge, YouWishlistedBadge } from './game-badges';

interface GameRowPillProps {
    name: string;
    coverUrl: string | null;
    href?: string;
    subtitle?: string;
    pricing?: ItadGamePricingDto | null;
    /** Optional custom badge rendered next to the name (before PriceBadge). */
    badge?: React.ReactNode;
    /**
     * ROK-1314: viewer personalization, OPT-IN. Self-profile row lists
     * (Steam library, wishlist, activity) deliberately pass nothing — every
     * row on your own library reading "You own" is noise, not information.
     */
    currentUserOwns?: boolean;
    /** ROK-1314: opt-in, same reasoning as {@link currentUserOwns}. */
    currentUserWishlisted?: boolean;
}

/** Small cover thumbnail or placeholder. */
function PillCover({
    url,
    alt,
}: {
    url: string | null;
    alt: string;
}): JSX.Element {
    if (url) {
        return (
            <img
                src={url}
                alt={alt}
                className="w-10 h-14 rounded object-cover flex-shrink-0"
                loading="lazy"
            />
        );
    }
    return (
        <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">
            ?
        </div>
    );
}

/** Text content: name, badges, optional subtitle. */
function PillContent({
    name,
    subtitle,
    pricing,
    badge,
    currentUserOwns,
    currentUserWishlisted,
}: {
    name: string;
    subtitle?: string;
    pricing?: ItadGamePricingDto | null;
    badge?: React.ReactNode;
    currentUserOwns?: boolean;
    currentUserWishlisted?: boolean;
}): JSX.Element {
    return (
        <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground truncate">
                    {name}
                </span>
                {badge}
                {currentUserOwns && <YouOwnBadge />}
                {currentUserWishlisted && <YouWishlistedBadge />}
                <PriceBadge pricing={pricing ?? null} />
            </div>
            {subtitle && (
                <span className="text-sm text-muted">{subtitle}</span>
            )}
        </div>
    );
}

const PILL_CLS =
    'bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity';

/**
 * Row-style game pill with optional cover, subtitle, and link behavior.
 * Used in hearted games lists, wishlists, and Steam library sections.
 */
export function GameRowPill({
    name,
    coverUrl,
    href,
    subtitle,
    pricing,
    badge,
    currentUserOwns,
    currentUserWishlisted,
}: GameRowPillProps): JSX.Element {
    const inner = (
        <>
            <PillCover url={coverUrl} alt={name} />
            <PillContent
                name={name}
                subtitle={subtitle}
                pricing={pricing}
                badge={badge}
                currentUserOwns={currentUserOwns}
                currentUserWishlisted={currentUserWishlisted}
            />
        </>
    );

    if (href) {
        return (
            <Link to={href} className={PILL_CLS}>
                {inner}
            </Link>
        );
    }

    return <div className={PILL_CLS}>{inner}</div>;
}
