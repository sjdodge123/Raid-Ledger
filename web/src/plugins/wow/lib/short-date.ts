/**
 * ROK-1789 Part B — the WoW plugin's single "Nov 10" date formatter (viewer
 * locale, month + day). Used by the Overview "Raid progress" card, the
 * Progression tab's boss rows / latest kill, and the guild activity feed.
 */

/** "Nov 10" in the viewer's locale. */
export function formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
