/**
 * Extracted sub-components for game cards (ROK-805).
 * Shared across UnifiedGameCard and other card layouts.
 */
import type { JSX } from 'react';
import { HEART_PATH, getRatingClasses } from './game-card-constants';
import { coopLabel, coopAriaLabel } from '../../lib/coop-label';

/** Game cover image with lazy loading. */
export function CoverImage({
    src,
    alt,
}: {
    src: string;
    alt: string;
}): JSX.Element {
    return (
        <img
            src={src}
            alt={alt}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
        />
    );
}

/** Placeholder icon when no cover image is available. */
export function CoverPlaceholder(): JSX.Element {
    return (
        <div className="absolute inset-0 flex items-center justify-center text-dim">
            <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
        </div>
    );
}

/** Rating badge overlay in the top-right corner. */
export function RatingBadge({
    rating,
}: {
    rating: number;
}): JSX.Element {
    return (
        <div
            aria-label={`Rating ${Math.round(rating)}`}
            className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-xs font-bold ${getRatingClasses(rating)}`}
        >
            {Math.round(rating)}
        </div>
    );
}

/** Gradient overlay at the bottom of the card cover. */
export function GradientOverlay(): JSX.Element {
    return (
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
    );
}

/** Title text at the bottom of the card cover. */
export function CardTitle({
    name,
}: {
    name: string;
}): JSX.Element {
    return (
        <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
            {name}
        </h3>
    );
}

/** Small genre pill badge. */
export function GenreBadge({
    label,
}: {
    label: string;
}): JSX.Element {
    return (
        // ROK-1314: `bg-white/20 text-white/90` measured 1.31:1 over a bright
        // cover — effectively invisible on light game art. It was tolerable
        // when this sat alone on the gradient; the badge row now wraps higher
        // up the artwork where there is no darkening. A dark scrim reads on
        // any cover (~8.7:1) and keeps genre visually NEUTRAL against the
        // colour-coded semantic badges beside it.
        <span className="inline-block px-1.5 py-0.5 text-[10px] bg-black/65 text-white rounded">
            {label}
        </span>
    );
}

/** Heart SVG shared by HeartIcon and HeartButton. */
function HeartSvg({ active }: { active: boolean }): JSX.Element {
    return (
        <svg
            className={`w-5 h-5 transition-colors ${active ? 'text-red-400 fill-red-400' : 'text-white/70'}`}
            fill={active ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={HEART_PATH} />
        </svg>
    );
}

/** Heart icon overlay (non-interactive, for toggle variant). */
export function HeartIcon({ selected }: { selected: boolean }): JSX.Element {
    return (
        <div className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50">
            <HeartSvg active={selected} />
        </div>
    );
}

/** Small count badge overlay for the heart button. */
function CountBadge({ count }: { count: number }): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">
            {count}
        </span>
    );
}

/** Interactive heart button with count badge (for link variant). */
export function HeartButton({
    wantToPlay,
    count,
    onClick,
}: {
    wantToPlay: boolean;
    count: number;
    onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
    const label = wantToPlay ? 'Remove from want to play' : 'Add to want to play';
    return (
        <button
            onClick={onClick}
            className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            aria-label={label}
        >
            <HeartSvg active={wantToPlay} />
            <CountBadge count={count} />
        </button>
    );
}

/** Star icon with numeric rating. */
function StarRating({ rating }: { rating: number }): JSX.Element {
    return (
        <span className="flex items-center gap-0.5">
            <svg
                className="w-3 h-3 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
            >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {Math.round(rating)}
        </span>
    );
}

/**
 * Compact co-op badge (ROK-1399, copy per ROK-1401 round 3).
 *
 * Copy comes from the shared {@link coopLabel} helper so the games-page card,
 * the Common Ground / AI tiles and the NominateModal row all speak the same
 * three-label vocabulary (`combo` / `online` / `local` co-op). The old
 * `👥 4 online` + 🛋 suffix form is gone: it read as "4 people currently
 * online", and the kind is now carried by the label itself.
 *
 * Deliberately carries no attribution — the Co-Optimus credit lives on the
 * game detail page (ROK-1398), never on the card.
 */
function CoopBadge({
    online,
    couch,
    combo,
}: {
    online: number | null | undefined;
    couch: number | null | undefined;
    combo: boolean | null | undefined;
}): JSX.Element | null {
    const resolved = coopLabel({ online, couch, combo });
    if (!resolved) return null;
    return (
        <span
            data-testid="card-coop-badge"
            role="img"
            aria-label={coopAriaLabel(resolved)}
            className="ml-auto inline-flex items-center whitespace-nowrap text-[10px] text-emerald-300"
        >
            {resolved.label}
        </span>
    );
}

/** Star rating + mode info bar below card cover. */
export function InfoBar({
    rating,
    primaryMode,
    cooptimusOnlineMax,
    cooptimusCouchMax,
    cooptimusComboCoop,
}: {
    rating: number | null | undefined;
    primaryMode: string | null;
    cooptimusOnlineMax?: number | null;
    cooptimusCouchMax?: number | null;
    cooptimusComboCoop?: boolean | null;
}): JSX.Element | null {
    const hasRating = rating != null && rating > 0;
    const coop = coopLabel({
        online: cooptimusOnlineMax,
        couch: cooptimusCouchMax,
        combo: cooptimusComboCoop,
    });
    if (!hasRating && !primaryMode && coop == null) return null;
    return (
        <div className="p-2.5 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted">
                {hasRating && <StarRating rating={rating!} />}
                {primaryMode && (
                    <>
                        <span className="text-dim">&middot;</span>
                        <span>{primaryMode}</span>
                    </>
                )}
                <CoopBadge
                    online={cooptimusOnlineMax}
                    couch={cooptimusCouchMax}
                    combo={cooptimusComboCoop}
                />
            </div>
        </div>
    );
}
