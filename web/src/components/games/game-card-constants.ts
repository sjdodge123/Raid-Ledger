/**
 * Shared constants for game card components (ROK-805).
 * Separated from game-card-parts.tsx to satisfy react-refresh rules.
 */

/** SVG path for the heart icon. */
export const HEART_PATH =
    'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z';

/** Return Tailwind color classes based on rating value. */
export function getRatingClasses(rating: number): string {
    if (rating >= 75) return 'bg-emerald-500/90 text-white';
    if (rating >= 50) return 'bg-yellow-500/90 text-black';
    return 'bg-red-500/90 text-white';
}

/** IGDB game mode ID to display name. */
export const MODE_MAP: Record<number, string> = {
    1: 'Single',
    2: 'Multi',
    3: 'Co-op',
    4: 'Split screen',
    5: 'MMO',
};
