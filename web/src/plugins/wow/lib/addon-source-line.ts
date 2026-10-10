/**
 * "via addon · 1 Oct 2026" — the addon snapshot date (ROK-1727 Q4: source +
 * date always shown). Shared by the Equipment source line and the Quests
 * summary (ROK-1745).
 */
export function formatAddonSourceLine(syncedAt: string): string {
    const date = new Date(syncedAt);
    if (Number.isNaN(date.getTime())) return 'via addon';
    return `via addon · ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
