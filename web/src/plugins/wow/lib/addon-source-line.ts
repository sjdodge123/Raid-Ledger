/** Snapshot sources that carry a capture date (ROK-2109: the Armory sync joins the addon). */
export type DatedSource = 'addon' | 'blizzard';

const SOURCE_WORD: Record<DatedSource, string> = { addon: 'addon', blizzard: 'Armory' };

/**
 * "via addon · 1 Oct 2026" / "via Armory · 7 Nov 2026" — the snapshot source and
 * its capture date (ROK-1727 Q4: source + date always shown). Shared by the
 * Equipment source line, the Quests summary (ROK-1745) and quest cards (ROK-2109).
 */
export function formatSourceLine(source: DatedSource, syncedAt: string): string {
    const label = `via ${SOURCE_WORD[source]}`;
    const date = new Date(syncedAt);
    if (Number.isNaN(date.getTime())) return label;
    return `${label} · ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** Addon-only wrapper kept for the Equipment / Lockouts callers. */
export function formatAddonSourceLine(syncedAt: string): string {
    return formatSourceLine('addon', syncedAt);
}

/** Narrow any progress/fact source to a dated one, or null (manual / roster / none). */
export function asDatedSource(source: string | null | undefined): DatedSource | null {
    return source === 'addon' || source === 'blizzard' ? source : null;
}
