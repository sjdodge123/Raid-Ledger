/**
 * Pelican admin connection API (ROK-121): `GET/PUT /admin/plugins/pelican/config`
 * and `POST /admin/plugins/pelican/test`. Responses are parsed with the
 * contract schemas, so a server that leaked the API key fails here too.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    PelicanConfigSchema,
    PelicanTestResultSchema,
    type PelicanConfig,
    type PelicanConfigUpdate,
    type PelicanTestResult,
} from '@raid-ledger/contract';
import { getAuthToken } from '../../../hooks/use-auth';
import { adminFetch } from '../../../hooks/admin/admin-fetch';

export const PELICAN_CONFIG_PATH = '/admin/plugins/pelican/config';
export const PELICAN_TEST_PATH = '/admin/plugins/pelican/test';
export const PELICAN_CONFIG_KEY = ['admin', 'plugins', 'pelican', 'config'] as const;

export function usePelicanConfig() {
    return useQuery<PelicanConfig>({
        queryKey: [...PELICAN_CONFIG_KEY],
        queryFn: async () => PelicanConfigSchema.parse(
            await adminFetch(PELICAN_CONFIG_PATH, undefined, 'Failed to load Pelican settings')),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

/** Saves the draft; the response is the new GET shape. Refreshes the plugin list so the card dot follows. */
export function useUpdatePelicanConfig() {
    const queryClient = useQueryClient();
    return useMutation<PelicanConfig, Error, PelicanConfigUpdate>({
        mutationFn: async (body) => PelicanConfigSchema.parse(await adminFetch(PELICAN_CONFIG_PATH, {
            method: 'PUT', body: JSON.stringify(body),
        }, 'Failed to save Pelican configuration')),
        onSuccess: (config) => {
            queryClient.setQueryData([...PELICAN_CONFIG_KEY], config);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'], exact: true });
        },
    });
}

/** Tests the STORED config (Save first) — always 200; the outcome is data. */
export function useTestPelicanConnection() {
    return useMutation<PelicanTestResult, Error>({
        mutationFn: async () => PelicanTestResultSchema.parse(
            await adminFetch(PELICAN_TEST_PATH, { method: 'POST' }, 'Failed to test the Pelican connection')),
    });
}
