import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

interface RelayStatus {
    enabled: boolean;
    relayUrl: string;
    instanceId: string | null;
    connected: boolean;
    error?: string;
}

interface RelaySettings {
    enabled: boolean;
    relayUrl: string;
}

interface ApiResponse {
    success: boolean;
    message: string;
}

/**
 * Hook for relay hub settings and connection management (ROK-273).
 */
export function useRelaySettings() {
    const queryClient = useQueryClient();

    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    // Get relay status
    const relayStatus = useQuery<RelayStatus>({
        queryKey: ['admin', 'relay'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/relay`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch relay status');
            }

            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    // Update relay settings
    const updateRelay = useMutation<ApiResponse, Error, Partial<RelaySettings>>({
        mutationFn: async (settings) => {
            const response = await fetch(`${API_BASE_URL}/admin/relay`, {
                method: 'PATCH',
                headers: getHeaders(),
                body: JSON.stringify(settings),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({
                    message: 'Failed to update relay settings',
                }));
                throw new Error(error.message || 'Failed to update relay settings');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'relay'] });
        },
    });

    // Connect to relay
    const connectRelay = useMutation<RelayStatus, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/relay/connect`, {
                method: 'POST',
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error('Failed to connect to relay');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'relay'] });
        },
    });

    // Disconnect from relay
    const disconnectRelay = useMutation<ApiResponse, Error>({
        mutationFn: async () => {
            const response = await fetch(
                `${API_BASE_URL}/admin/relay/disconnect`,
                {
                    method: 'POST',
                    headers: getHeaders(),
                },
            );

            if (!response.ok) {
                throw new Error('Failed to disconnect from relay');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'relay'] });
        },
    });

    return {
        relayStatus,
        updateRelay,
        connectRelay,
        disconnectRelay,
    };
}
