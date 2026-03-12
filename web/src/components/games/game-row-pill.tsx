/**
 * Shared row pill component for game lists (ROK-805).
 * Replaces HeartedGameCard, WishlistCard, and SteamLibraryCard.
 * Renders as a Link when href is provided, otherwise as a div.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';

interface GameRowPillProps {
    gameId: number;
    name: string;
    coverUrl: string | null;
    href?: string;
    subtitle?: string;
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

/** Text content: name and optional subtitle. */
function PillContent({
    name,
    subtitle,
}: {
    name: string;
    subtitle?: string;
}): JSX.Element {
    if (subtitle) {
        return (
            <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground truncate block">
                    {name}
                </span>
                <span className="text-sm text-muted">{subtitle}</span>
            </div>
        );
    }
    return (
        <span className="font-medium text-foreground truncate">{name}</span>
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
}: GameRowPillProps): JSX.Element {
    const inner = (
        <>
            <PillCover url={coverUrl} alt={name} />
            <PillContent name={name} subtitle={subtitle} />
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
