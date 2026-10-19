/** ROK-1831 — server-hub member labels. */
import { formatDistanceToNow } from 'date-fns';
import type { HubMemberRow } from '../../hub-module';

/** "Last seen 3 days ago", or "Joined, not played yet" when presence never saw them. */
export function lastSeenLabel(row: HubMemberRow): string {
    const at = row.server?.lastSeenAt ?? null;
    if (at === null) return 'Joined, not played yet';
    return `Last seen ${formatDistanceToNow(new Date(at), { addSuffix: true })}`;
}
