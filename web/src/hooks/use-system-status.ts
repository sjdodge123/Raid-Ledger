import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import type { SystemStatusDto } from '@raid-ledger/contract';

/**
 * Fetch system status from API (ROK-175 AC-4)
 */
async function getSystemStatus(): Promise<SystemStatusDto> {
    const response = await fetch(`${API_BASE_URL}/system/status`, {
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error('Failed to fetch system status');
    }

    return response.json();
}

/**
 * Hook to fetch system status for first-run detection and Discord configuration.
 * Used by LoginPage to show appropriate UI (ROK-175).
 */
export function useSystemStatus() {
    return useQuery({
        queryKey: ['system', 'status'],
        queryFn: getSystemStatus,
        staleTime: 60_000, // Cache for 1 minute
        retry: 1, // Only retry once on failure
    });
}
