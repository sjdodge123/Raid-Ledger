import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { BnetProbeRegion, BnetProbeStartResponseDto, BnetProbeStateDto } from '@raid-ledger/contract';
import { getBnetProbeState, startBnetProbe } from '../api-client';

/** TanStack Query key for the admin Battle.net account probe state (ROK-2129). */
export const BNET_PROBE_KEY = ['admin', 'blizzard', 'bnet-account-probe'] as const;

/**
 * Admin Battle.net account probe (ROK-2129, DEMO_MODE only): the redirect URI
 * + latest result, and a Start mutation that returns the authorize URL.
 * `enabled` keeps the state read off when DEMO_MODE is off (the route 403s).
 */
export function useBnetAccountProbe(enabled: boolean): {
    probe: UseQueryResult<BnetProbeStateDto>;
    start: UseMutationResult<BnetProbeStartResponseDto, Error, BnetProbeRegion>;
} {
    const probe = useQuery({ queryKey: [...BNET_PROBE_KEY], queryFn: getBnetProbeState, enabled, staleTime: 30_000 });
    const start = useMutation<BnetProbeStartResponseDto, Error, BnetProbeRegion>({ mutationFn: startBnetProbe });
    return { probe, start };
}
