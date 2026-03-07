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

function usePluginMutations() {
    const queryClient = useQueryClient();
    const invalidatePlugins = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] });
        queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };

    return {
        install: useMutation<void, Error, string>({ mutationFn: installPlugin, onSuccess: invalidatePlugins }),
        uninstall: useMutation<void, Error, string>({ mutationFn: uninstallPlugin, onSuccess: invalidatePlugins }),
        activate: useMutation<void, Error, string>({ mutationFn: activatePlugin, onSuccess: invalidatePlugins }),
        deactivate: useMutation<void, Error, string>({ mutationFn: deactivatePlugin, onSuccess: invalidatePlugins }),
    };
}

export function usePluginAdmin() {
    const plugins = useQuery<PluginInfoDto[]>({
        queryKey: ['admin', 'plugins'],
        queryFn: getPlugins,
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
    return { plugins, ...usePluginMutations() };
}
