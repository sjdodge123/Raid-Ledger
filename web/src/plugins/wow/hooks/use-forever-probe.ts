import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ForeverProbeConfigDto, ForeverProbeResultDto, ForeverProbeStateDto } from '@raid-ledger/contract';
import { fetchForeverProbe, runForeverProbe, updateForeverProbeConfig } from '../api-client';

/** TanStack Query key for the admin Forever namespace probe state (ROK-1716). */
export const FOREVER_PROBE_KEY = ['admin', 'blizzard', 'forever-probe'] as const;

/** Admin Forever namespace probe (ROK-1716): latest state, a Run now mutation and a config save. */
export function useForeverProbe(): {
    probe: UseQueryResult<ForeverProbeStateDto>;
    run: UseMutationResult<ForeverProbeResultDto, Error, void>;
    saveConfig: UseMutationResult<ForeverProbeStateDto, Error, ForeverProbeConfigDto>;
} {
    const queryClient = useQueryClient();
    const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: [...FOREVER_PROBE_KEY] });
    const probe = useQuery({ queryKey: [...FOREVER_PROBE_KEY], queryFn: fetchForeverProbe, staleTime: 30_000 });
    const run = useMutation<ForeverProbeResultDto, Error, void>({ mutationFn: runForeverProbe, onSuccess: invalidate });
    const saveConfig = useMutation<ForeverProbeStateDto, Error, ForeverProbeConfigDto>({
        mutationFn: updateForeverProbeConfig,
        onSuccess: invalidate,
    });
    return { probe, run, saveConfig };
}
