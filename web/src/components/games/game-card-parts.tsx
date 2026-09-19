/**
 * Extracted sub-components for game cards (ROK-805).
 * Shared across UnifiedGameCard and other card layouts.
 */
import type { JSX } from 'react';
import { HEART_PATH, getRatingClasses } from './game-card-constants';
import { COVER_INTRINSIC, coverSrcSetProps } from '../../lib/igdb-image';

/**
 * Game cover image (ROK-1159).
 *
 * Carries the four attributes that make cover art cheap by default, so every
 * card composed from this part inherits them:
 * - intrinsic `width`/`height` from IGDB's `t_cover_big` rendition, which
 *   reserves the aspect-ratio box and stops the grid reflowing as covers land.
 *   CSS (`w-full h-full`) still governs the painted size; these only supply the
 *   ratio.
 * - `loading="lazy"` + `decoding="async"` — a games grid ships 100+ covers and
 *   almost all of them start below the fold.
 * - a responsive `srcSet`, but only when the URL is a rewritable IGDB one; ITAD
 *   boxart gets no `srcSet` at all (see `lib/igdb-image.ts`).
 *
 * `priority` opts a known-LCP cover out of lazy loading. Use it for at most one
 * image per page (a detail-page hero) — marking a grid eager defeats the point.
 */
export function CoverImage({
    src,
    alt,
    sizes = '(max-width: 640px) 45vw, 200px',
    priority = false,
}: {
    src: string;
    alt: string;
    /** CSS width the cover paints at, for `srcSet` selection. */
    sizes?: string;
    /** Above-the-fold LCP image: load eagerly at high priority. */
    priority?: boolean;
}): JSX.Element {
    return (
        <img
            src={src}
            alt={alt}
            width={COVER_INTRINSIC.width}
            height={COVER_INTRINSIC.height}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
            {...(priority ? { fetchPriority: 'high' as const } : {})}
            {...coverSrcSetProps(src, sizes)}
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
