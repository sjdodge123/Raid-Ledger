/**
 * "4 min ago" for a sync timestamp — the ONE synced-ago wording (ROK-1595).
 * The Calendars card ("Synced 4 min ago · 2 calendars") and the "I'm away"
 * calendar divider ("Synced 4 min ago") both prefix it with `READ_COPY.synced`.
 * The design mirror only shows the minutes form; hours/days are lane copy.
 * Lives in `lib/` so `features/game-time` and `features/calendar-sync` share it
 * without importing each other.
 */
export function syncedAgo(iso: string, now: number = Date.now()): string {
    const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}
