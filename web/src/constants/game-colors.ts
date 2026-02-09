/**
 * Shared game color definitions used across calendar and event cards
 * 
 * These colors provide consistent visual identity for each game type:
 * - bg: Background color for calendar events
 * - border: Border color for calendar events
 * - text: Text color (usually white for contrast)
 * - gradient: Gradient for event card placeholders
 * - icon: Emoji icon when cover art is unavailable
 */

export interface GameColorConfig {
    bg: string;
    border: string;
    text: string;
    gradient: string;
    icon: string;
}

/**
 * Color configurations by game slug.
 * Supports both short registry slugs (wow, ffxiv) and full IGDB slugs (world-of-warcraft).
 */
export const GAME_COLORS: Record<string, GameColorConfig> = {
    // Short registry slugs
    wow: {
        bg: '#9333ea',
        border: '#a855f7',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #9333ea, #581c87)',
        icon: '⚔️',
    },
    ffxiv: {
        bg: '#3b82f6',
        border: '#60a5fa',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
        icon: '🏠',
    },
    valheim: {
        bg: '#22c55e',
        border: '#4ade80',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #22c55e, #15803d)',
        icon: '🪓',
    },
    // Full IGDB slugs (map to same colors as short slugs)
    'world-of-warcraft': {
        bg: '#9333ea',
        border: '#a855f7',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #9333ea, #581c87)',
        icon: '⚔️',
    },
    'final-fantasy-xiv-online': {
        bg: '#3b82f6',
        border: '#60a5fa',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
        icon: '🏠',
    },
    // Generic fallback
    generic: {
        bg: '#6b7280',
        border: '#9ca3af',
        text: '#ffffff',
        gradient: 'linear-gradient(135deg, #6b7280, #374151)',
        icon: '🎮',
    },
};

/**
 * Get color configuration for a game by slug
 */
export function getGameColors(slug: string | undefined): GameColorConfig {
    if (slug && GAME_COLORS[slug]) {
        return GAME_COLORS[slug];
    }
    return GAME_COLORS.generic;
}

/**
 * Get game time block styling (shared between GameTimeGrid overlays and CalendarView).
 * Extracts the gradient pattern from WeekEventComponent for reuse.
 */
export function getGameTimeBlockStyle(
    slug: string | undefined,
    coverUrl: string | null | undefined,
): React.CSSProperties {
    const colors = getGameColors(slug);
    return {
        backgroundImage: coverUrl
            ? `linear-gradient(180deg, ${colors.bg}f5 0%, ${colors.bg}ee 60%, ${colors.bg}cc 100%), url(${coverUrl})`
            : `linear-gradient(180deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderLeft: `3px solid ${colors.border}`,
    };
}

/**
 * Get calendar event styling props for a game
 */
export function getCalendarEventStyle(slug: string | undefined): React.CSSProperties {
    const colors = getGameColors(slug);
    return {
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '4px',
        color: colors.text,
        padding: '2px 6px',
        fontSize: '0.75rem',
        fontWeight: '500',
        cursor: 'pointer',
    };
}
