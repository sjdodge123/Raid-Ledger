import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import type { VersionInfoDto, UpdateStatusDto } from '@raid-ledger/contract';

/**
 * Fetch public version info (ROK-294).
 * Cached for 5 minutes since version rarely changes.
 */
export function useVersionInfo() {
    return useQuery<VersionInfoDto>({
        queryKey: ['system', 'version'],
        queryFn: () => fetchApi<VersionInfoDto>('/system/version'),
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * Fetch admin update status (ROK-294).
 * Only enabled when a token is present.
 */
export function useUpdateStatus(enabled: boolean) {
    return useQuery<UpdateStatusDto>({
        queryKey: ['admin', 'update-status'],
        queryFn: () => fetchApi<UpdateStatusDto>('/admin/update-status'),
        staleTime: 60 * 1000,
        enabled,
    });
}
