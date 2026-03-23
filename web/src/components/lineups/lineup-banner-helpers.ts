/**
 * Helper utilities for the LineupBanner component (ROK-935).
 */

/** Format a date string into a short display format (e.g., "Mar 28"). */
export function formatTargetDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return null;
    }
}
