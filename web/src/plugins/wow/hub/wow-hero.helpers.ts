/**
 * ROK-1830 — the WoW guild's hero note: the "Last imported from LedgerLink"
 * line under the next-raid chip. Pure, so it lives beside the pills rather
 * than in them (`react-refresh/only-export-components`).
 */
import type { HubCtx } from '../../hub-module';

export function wowHeroNote({ page }: HubCtx): string | null {
    const at = page.guild.lastSnapshotAt;
    if (!at) return null;
    const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return page.importedBy ? `Last imported from LedgerLink ${when} by ${page.importedBy}` : `Last imported from LedgerLink ${when}`;
}
