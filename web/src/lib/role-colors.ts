/**
 * Shared role color constants for consistent role display across all
 * roster, assignment, and attendee components (ROK-210 AC-3).
 */

/** Tailwind badge classes for role pills */
export const ROLE_BADGE_CLASSES: Record<string, string> = {
    tank: 'bg-blue-600/30 text-blue-300',
    healer: 'bg-green-600/30 text-green-300',
    dps: 'bg-red-600/30 text-red-300',
    flex: 'bg-purple-600/30 text-purple-300',
    player: 'bg-indigo-600/30 text-indigo-300',
    bench: 'bg-slate-600/30 text-slate-300',
};

/** Role emoji icons */
export const ROLE_EMOJI: Record<string, string> = {
    tank: '\u{1F6E1}\uFE0F',
    healer: '\u{1F49A}',
    dps: '\u2694\uFE0F',
    flex: '\u{1F504}',
    player: '\u{1F3AE}',
    bench: '\u{1FA91}',
};

/** Role color values for styled slot buttons and left-border accents */
export const ROLE_SLOT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    tank: { bg: 'rgba(37, 99, 235, 0.15)', border: 'rgba(37, 99, 235, 0.4)', text: '#93c5fd' },
    healer: { bg: 'rgba(22, 163, 74, 0.15)', border: 'rgba(22, 163, 74, 0.4)', text: '#86efac' },
    dps: { bg: 'rgba(220, 38, 38, 0.15)', border: 'rgba(220, 38, 38, 0.4)', text: '#fca5a5' },
    flex: { bg: 'rgba(147, 51, 234, 0.15)', border: 'rgba(147, 51, 234, 0.4)', text: '#c4b5fd' },
    player: { bg: 'rgba(99, 102, 241, 0.15)', border: 'rgba(99, 102, 241, 0.4)', text: '#a5b4fc' },
    bench: { bg: 'rgba(100, 116, 139, 0.15)', border: 'rgba(100, 116, 139, 0.4)', text: '#94a3b8' },
};

/** Tailwind left-border classes for roster list items */
export const ROLE_BORDER_CLASSES: Record<string, string> = {
    tank: 'border-l-blue-500',
    healer: 'border-l-green-500',
    dps: 'border-l-red-500',
    flex: 'border-l-purple-500',
    player: 'border-l-indigo-500',
    bench: 'border-l-slate-500',
};

/** Capitalize first letter of a role name */
export function formatRole(role: string): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
}
