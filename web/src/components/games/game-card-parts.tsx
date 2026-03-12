/**
 * Extracted sub-components for game cards (ROK-805).
 * Shared across UnifiedGameCard and other card layouts.
 */
import type { JSX } from 'react';
import { HEART_PATH, getRatingClasses } from './game-card-constants';

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
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
        />
    );
}

/** Placeholder icon when no cover image is available. */
export function CoverPlaceholder(): JSX.Element {
    return (
        <div className="w-full h-full flex items-center justify-center text-dim">
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
        <span className="inline-block px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">
            {label}
        </span>
    );
}

/** Heart icon overlay (non-interactive, for toggle variant). */
export function HeartIcon({
    selected,
}: {
    selected: boolean;
}): JSX.Element {
    return (
        <div className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50">
            <svg
                className={`w-5 h-5 transition-colors ${selected ? 'text-red-400 fill-red-400' : 'text-white/70'}`}
                fill={selected ? 'currentColor' : 'none'}
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={HEART_PATH}
                />
            </svg>
        </div>
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
    return (
        <button
            onClick={onClick}
            className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            aria-label={
                wantToPlay
                    ? 'Remove from want to play'
                    : 'Add to want to play'
            }
        >
            <svg
                className={`w-5 h-5 transition-colors ${wantToPlay ? 'text-red-400 fill-red-400' : 'text-white/70'}`}
                fill={wantToPlay ? 'currentColor' : 'none'}
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={HEART_PATH}
                />
            </svg>
            {count > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">
                    {count}
                </span>
            )}
        </button>
    );
}

/** Star rating + mode info bar below card cover. */
export function InfoBar({
    rating,
    primaryMode,
}: {
    rating: number | null | undefined;
    primaryMode: string | null;
}): JSX.Element {
    return (
        <div className="p-2.5 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted">
                {rating != null && rating > 0 && (
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
                )}
                {primaryMode && (
                    <>
                        <span className="text-dim">&middot;</span>
                        <span>{primaryMode}</span>
                    </>
                )}
            </div>
        </div>
    );
}
