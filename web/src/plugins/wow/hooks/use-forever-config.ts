import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { WowForeverConfigDto, WowForeverConfigResponseDto } from '@raid-ledger/contract';
import { fetchForeverConfig, updateForeverConfig } from '../api-client';
import { ARMORY_CAPABILITIES_KEY } from './use-armory-capabilities';
import { FOREVER_QUEST_IMPORT_KEY } from './use-forever-quest-import';

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
            // ROK-2162: a save can start an automatic quest import server-side — re-read its status.
            // Best effort: the kick is fire-and-forget; the panel's 30 s idle poll is the guarantee.
            void queryClient.invalidateQueries({ queryKey: [...FOREVER_QUEST_IMPORT_KEY] });
        },
    });
    return { config, update };
}
