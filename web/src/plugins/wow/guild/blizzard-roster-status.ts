/**
 * ROK-1928 D2 — the settings section's one-line status of the last Blizzard
 * roster sync. Copy is the spec's, verbatim.
 */
import type { GuildBlizzardRosterView } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

/** The status line, or null before the first sync. */
export function blizzardRosterStatusLine(roster: Pick<GuildBlizzardRosterView, 'status' | 'syncedAt'>): string | null {
    switch (roster.status) {
        case 'ok':
            return roster.syncedAt === null ? 'Roster via Blizzard' : `Roster via Blizzard · synced ${syncedAgo(roster.syncedAt)}`;
        case 'not_found':
            return "Blizzard didn't find this guild — showing the LedgerLink roster";
        case 'error':
            return 'Last Blizzard sync failed — showing the last roster';
        case 'skipped_empty':
            return 'Blizzard returned an empty roster — kept the last one';
        default:
            return null;
    }
}
