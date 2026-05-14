/**
 * useLineupAbortedAt — detects whether a lineup has been aborted by reading
 * its activity timeline (ROK-1209 AC-17). No contract/migration change needed.
 *
 * ROK-1207: also returns the abort reason from the latest `lineup_aborted`
 * entry's `metadata.reason`, so the detail-page banner can surface it.
 */
import { useMemo } from 'react';
import type { ActivityEntryDto } from '@raid-ledger/contract';
import { useActivityTimeline } from '../hooks/use-activity-timeline';

export interface AbortedAtResult {
    abortedAt: string | null;
    reason: string | null;
    isLoading: boolean;
}

function readReason(entry: ActivityEntryDto): string | null {
    const raw = entry.metadata?.reason;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

export function useLineupAbortedAt(lineupId: number): AbortedAtResult {
    const { data, isLoading } = useActivityTimeline('lineup', lineupId);

    const latestAbort = useMemo<ActivityEntryDto | null>(() => {
        const entries = data?.data ?? [];
        const aborts = entries.filter((e) => e.action === 'lineup_aborted');
        if (aborts.length === 0) return null;
        return aborts.reduce((latest, e) =>
            !latest || e.createdAt > latest.createdAt ? e : latest,
        );
    }, [data]);

    return {
        abortedAt: latestAbort?.createdAt ?? null,
        reason: latestAbort ? readReason(latestAbort) : null,
        isLoading,
    };
}
