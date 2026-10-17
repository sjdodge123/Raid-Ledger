/**
 * `GET /lfg/bridge/:lineupId` (ROK-1457) — the viewer's nominations that lost
 * the lineup and that they hold no live intent on. Drives the decided-page
 * "still want to play?" prompt.
 *
 * The key sits inside the `['lfg']` prefix so `useJoinGroup`'s invalidation
 * refetches it: raising a hand makes the server drop that game on the next
 * read, and the button disappears with no extra client state.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LfgBridgeOfferDto } from '@raid-ledger/contract';
import { getLfgBridgeOffers } from '../lib/api/lfg-api';
import { useAuth } from './use-auth';

/** Query key for one lineup's bridge offers. */
export function lfgBridgeQueryKey(lineupId: number) {
    return ['lfg', 'bridge', lineupId] as const;
}

/** The caller's open LFG offers for a decided lineup. */
export function useLfgBridgeOffers(
    lineupId: number,
): UseQueryResult<LfgBridgeOfferDto[]> {
    const { user } = useAuth();
    return useQuery<LfgBridgeOfferDto[]>({
        queryKey: lfgBridgeQueryKey(lineupId),
        queryFn: () => getLfgBridgeOffers(lineupId),
        enabled: !!user,
        staleTime: 1000 * 60,
        // A hand raised on another surface must not leave a stale offer here.
        refetchOnMount: 'always',
    });
}
