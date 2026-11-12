import { syncedAgo } from '../../../lib/synced-ago';

/** Snapshot sources that carry a capture date (ROK-2109: the Armory sync joins the addon). */
export type DatedSource = 'addon' | 'blizzard';

const SOURCE_WORD: Record<DatedSource, string> = { addon: 'addon', blizzard: 'Armory' };

/** "9 Nov 2026" — the house capture-date format; null for a missing or unparseable time. */
export function formatCaptureDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "<label> · 9 Nov 2026", or the bare label when the time is missing (ROK-2144). */
export function formatDatedLine(label: string, iso: string | null | undefined): string {
    const date = formatCaptureDate(iso);
    return date ? `${label} · ${date}` : label;
}

/**
 * "via addon · 1 Oct 2026" / "via Armory · 7 Nov 2026" — the snapshot source and
 * its capture date (ROK-1727 Q4: source + date always shown). Shared by the
 * Equipment source line, the Quests summary (ROK-1745) and quest cards (ROK-2109).
 */
export function formatSourceLine(source: DatedSource, syncedAt: string): string {
    return formatDatedLine(`via ${SOURCE_WORD[source]}`, syncedAt);
}

/** "as of 2 days ago via Armory" — the relative form (ROK-1927 mockup F7, the own attunement checklists). */
export function formatAsOfSourceLine(source: DatedSource, syncedAt: string, now: number = Date.now()): string {
    return `as of ${syncedAgo(syncedAt, now)} via ${SOURCE_WORD[source]}`;
}

/** Addon-only wrapper kept for the Equipment / Lockouts callers. */
export function formatAddonSourceLine(syncedAt: string): string {
    return formatSourceLine('addon', syncedAt);
}

/** Narrow any progress/fact source to a dated one, or null (manual / roster / none). */
export function asDatedSource(source: string | null | undefined): DatedSource | null {
    return source === 'addon' || source === 'blizzard' ? source : null;
}
