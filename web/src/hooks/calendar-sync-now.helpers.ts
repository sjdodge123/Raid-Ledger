/**
 * "Sync now" follow-through (ROK-1595 review #1). A 202 means the sync is
 * QUEUED, not done, so refetching straight away reads the old state. Instead
 * re-read the overview a bounded number of times until the connection's
 * `lastSyncedAt` moves past what it was before the click, then refetch every
 * read dependent (synced away days, the busy band, scheduling). If the sync
 * never lands inside the cap, refresh the dependents once anyway and stop —
 * there is no open-ended polling.
 */
import type { QueryClient } from '@tanstack/react-query';
import { CalendarsOverviewSchema, type CalendarsOverview } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { invalidateReadDependents } from './calendar-read.helpers';

/** At most this many overview re-reads per click (6 × 5s ≈ 30s). */
export const SYNC_LAND_MAX_TRIES = 6;
export const SYNC_LAND_DELAY_MS = 5_000;

/** The connection's `lastSyncedAt` in a cached or fetched overview. */
export function lastSyncedOf(overview: CalendarsOverview | undefined, id: number): string | null {
    return overview?.connections.find((c) => c.id === id)?.lastSyncedAt ?? null;
}

/** True once `next` is a later sync than `before` (null before = never synced). */
export function syncAdvanced(before: string | null, next: string | null): boolean {
    if (next === null) return false;
    return before === null || Date.parse(next) > Date.parse(before);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Re-read the overview until `id`'s sync lands (or the cap runs out), then refresh the dependents. */
export async function refreshWhenSynced(
    qc: QueryClient, id: number, before: string | null, delayMs = SYNC_LAND_DELAY_MS,
): Promise<void> {
    for (let attempt = 0; attempt < SYNC_LAND_MAX_TRIES; attempt += 1) {
        await wait(delayMs);
        const overview = await qc.fetchQuery({
            queryKey: [...CALENDARS_OVERVIEW_KEY],
            queryFn: () => fetchApi('/users/me/calendars', {}, CalendarsOverviewSchema),
            staleTime: 0,
        }).catch(() => undefined);
        if (syncAdvanced(before, lastSyncedOf(overview, id))) break;
    }
    await invalidateReadDependents(qc);
}
