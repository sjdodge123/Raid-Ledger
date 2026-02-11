import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PluginInfoDto } from '@raid-ledger/contract';
import {
    getPlugins,
    installPlugin,
    uninstallPlugin,
    activatePlugin,
    deactivatePlugin,
} from '../lib/api-client';
import { getAuthToken } from './use-auth';

export function usePluginAdmin() {
    const queryClient = useQueryClient();

    const invalidatePlugins = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] });
        queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };

    const pluginsQuery = useQuery<PluginInfoDto[]>({
        queryKey: ['admin', 'plugins'],
        queryFn: getPlugins,
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const install = useMutation<void, Error, string>({
        mutationFn: installPlugin,
        onSuccess: invalidatePlugins,
    });

    const uninstall = useMutation<void, Error, string>({
        mutationFn: uninstallPlugin,
        onSuccess: invalidatePlugins,
    });

    const activate = useMutation<void, Error, string>({
        mutationFn: activatePlugin,
        onSuccess: invalidatePlugins,
    });

    const deactivate = useMutation<void, Error, string>({
        mutationFn: deactivatePlugin,
        onSuccess: invalidatePlugins,
    });

    return {
        plugins: pluginsQuery,
        install,
        uninstall,
        activate,
        deactivate,
    };
}
