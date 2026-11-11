/** ROK-1958 D-14 — BG3 query keys. Every key starts `['bg3', …]`. */
import type { QueryClient } from '@tanstack/react-query';
import { hubClaimKey } from '../../../components/hub/claim/use-hub-claim';

export const bg3Keys = {
    all: ['bg3'] as const,
    campaigns: (hubId: number) => ['bg3', 'campaigns', hubId] as const,
    snapshot: (hubId: number) => ['bg3', 'snapshot', hubId] as const,
    sessions: (hubId: number, campaignId: number, cursor: string | null) =>
        ['bg3', 'sessions', hubId, campaignId, cursor] as const,
    sessionPages: (hubId: number, campaignId: number) =>
        ['bg3', 'sessions', hubId, campaignId, 'pages'] as const,
    myUnassignedSaves: ['bg3', 'my-saves', 'unassigned'] as const,
    /** ROK-2068 Manage my saves — covered by `invalidateBg3Hub`'s `my-saves` match. */
    myAllSaves: ['bg3', 'my-saves', 'all'] as const,
};

/**
 * Invalidate every BG3 query of `hubId` plus the caller's own saves, and the
 * hub's core claim status (ROK-2153 S6): a Party-card claim, an unclaim or an
 * active-campaign switch changes what the shared Overview prompt offers.
 */
export async function invalidateBg3Hub(qc: QueryClient, hubId: number): Promise<void> {
    await Promise.all([
        qc.invalidateQueries({
            predicate: ({ queryKey }) => queryKey[0] === 'bg3' && (queryKey[2] === hubId || queryKey[1] === 'my-saves'),
        }),
        qc.invalidateQueries({ queryKey: hubClaimKey(hubId) }),
    ]);
}
