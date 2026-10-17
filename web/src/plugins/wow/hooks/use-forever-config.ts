import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { WowForeverConfigDto, WowForeverConfigResponseDto } from '@raid-ledger/contract';
import { fetchForeverConfig, updateForeverConfig } from '../api-client';
import { ARMORY_CAPABILITIES_KEY } from './use-armory-capabilities';

const FOREVER_CONFIG_KEY = ['admin', 'plugins', 'blizzard', 'forever'] as const;

/** Admin WoW Forever settings (ROK-1717): the saved config and a save mutation. */
export function useForeverConfig(): {
    config: UseQueryResult<WowForeverConfigResponseDto>;
    update: UseMutationResult<WowForeverConfigResponseDto, Error, WowForeverConfigDto>;
} {
    const queryClient = useQueryClient();
    const config = useQuery({ queryKey: [...FOREVER_CONFIG_KEY], queryFn: fetchForeverConfig, staleTime: 30_000 });
    const update = useMutation<WowForeverConfigResponseDto, Error, WowForeverConfigDto>({
        mutationFn: updateForeverConfig,
        onSuccess: (saved) => {
            queryClient.setQueryData([...FOREVER_CONFIG_KEY], saved);
            // The Add Character Armory gate reads the public capability — refresh it now.
            void queryClient.invalidateQueries({ queryKey: [...ARMORY_CAPABILITIES_KEY] });
        },
    });
    return { config, update };
}
