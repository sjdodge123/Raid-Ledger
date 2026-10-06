import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BlizzardCapabilitiesDto } from '@raid-ledger/contract';
import { fetchBlizzardCapabilities } from '../api-client';

/** Query key for the runtime Blizzard capabilities; the admin Forever form invalidates it on save. */
export const ARMORY_CAPABILITIES_KEY = ['blizzard', 'capabilities'] as const;

/**
 * Runtime Armory capabilities (ROK-1717). `data` is undefined while loading or
 * after a failure, which the armory-import helpers treat as "Forever
 * unsupported" (fail closed, D6).
 */
export function useArmoryCapabilities(): UseQueryResult<BlizzardCapabilitiesDto> {
    return useQuery({
        queryKey: [...ARMORY_CAPABILITIES_KEY],
        queryFn: fetchBlizzardCapabilities,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: false,
    });
}
