/**
 * useLineupAbortedAt — detects whether a lineup has been aborted by reading
 * its activity timeline (ROK-1209 AC-17). No contract/migration change needed.
 */
import { useMemo } from 'react';
import { useActivityTimeline } from '../hooks/use-activity-timeline';

export interface AbortedAtResult {
    abortedAt: string | null;
    isLoading: boolean;
}

export function useLineupAbortedAt(lineupId: number): AbortedAtResult {
    const { data, isLoading } = useActivityTimeline('lineup', lineupId);

    const abortedAt = useMemo<string | null>(() => {
        const entries = data?.data ?? [];
        const aborts = entries.filter((e) => e.action === 'lineup_aborted');
        if (aborts.length === 0) return null;
        return aborts.reduce((latest, e) =>
            !latest || e.createdAt > latest.createdAt ? e : latest,
        ).createdAt;
    }, [data]);

    return { abortedAt, isLoading };
}
