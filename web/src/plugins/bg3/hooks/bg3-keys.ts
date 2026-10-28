/** ROK-1958 D-14 — BG3 query keys. Every key starts `['bg3', …]`. */
import type { QueryClient } from '@tanstack/react-query';

export const bg3Keys = {
    all: ['bg3'] as const,
    campaigns: (hubId: number) => ['bg3', 'campaigns', hubId] as const,
    snapshot: (hubId: number) => ['bg3', 'snapshot', hubId] as const,
    sessions: (hubId: number, campaignId: number, cursor: string | null) =>
        ['bg3', 'sessions', hubId, campaignId, cursor] as const,
    sessionPages: (hubId: number, campaignId: number) =>
        ['bg3', 'sessions', hubId, campaignId, 'pages'] as const,
    myUnassignedSaves: ['bg3', 'my-saves', 'unassigned'] as const,
};

/** Invalidate every BG3 query of `hubId` plus the caller's own saves. */
export function invalidateBg3Hub(qc: QueryClient, hubId: number): Promise<void> {
    return qc.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'bg3' && (queryKey[2] === hubId || queryKey[1] === 'my-saves'),
    });
}
