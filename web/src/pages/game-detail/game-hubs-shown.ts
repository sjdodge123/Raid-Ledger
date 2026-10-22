/**
 * ROK-1883 — which hubs the game page's Hubs card lists (operator ruling 3):
 * every hub the viewer is in, then others up to three rows in total. Each id
 * appears once, whatever the payload carries.
 */
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { isHubMember } from './hub-join';

/** Rows shown before "See all" when the viewer is in fewer hubs than this. */
export const MIN_SHOWN = 3;

/** The payload's hubs with a repeated id dropped (first wins). */
export function uniqueHubs(hubs: readonly HubDirectoryEntry[]): HubDirectoryEntry[] {
    const seen = new Set<number>();
    return hubs.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/** Joined hubs first (payload order kept within each group), capped at `max(3, joined)`. */
export function pickShownHubs(hubs: readonly HubDirectoryEntry[]): HubDirectoryEntry[] {
    const unique = uniqueHubs(hubs);
    const joined = unique.filter(isHubMember);
    const others = unique.filter((h) => !isHubMember(h));
    return [...joined, ...others].slice(0, Math.max(MIN_SHOWN, joined.length));
}
