import type { JSX } from 'react';
import { useState } from 'react';
import { toast } from '../../lib/toast';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import type { PluginInfoDto } from '@raid-ledger/contract';
import { PluginCard } from './plugins/PluginCard';
import { UninstallConfirmModal } from '../admin-settings/UninstallConfirmModal';

/**
 * Plugins > Manage Plugins panel.
 * ROK-281 v2: Card-based layout showing full plugin details at a glance.
 * No collapsible sections — all info visible: author, capabilities, game slugs, integrations.
 */
async function executePluginMutation(mutations: Record<string, { mutateAsync: (s: string) => Promise<void> }>, action: string, slug: string): Promise<void> {
    try {
        await mutations[action].mutateAsync(slug);
        toast.success(`Plugin ${action}d`);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action} plugin`);
    }
}

export function PluginsPanel(): JSX.Element {
    const { plugins, install, uninstall, activate, deactivate } = usePluginAdmin();
    const [confirmPlugin, setConfirmPlugin] = useState<PluginInfoDto | null>(null);
    const isPending = install.isPending || uninstall.isPending || activate.isPending || deactivate.isPending;

    const handleAction = (action: 'install' | 'activate' | 'deactivate', slug: string): void => {
        void executePluginMutation({ install, activate, deactivate }, action, slug);
    };

    const handleUninstallRequest = (slug: string): void => {
        const plugin = plugins.data?.find((p) => p.slug === slug);
        if (plugin) setConfirmPlugin(plugin);
    };

    const handleUninstallConfirm = async (): Promise<void> => {
        if (!confirmPlugin) return;
        try {
            await uninstall.mutateAsync(confirmPlugin.slug);
            toast.success('Plugin uninstalled');
            setConfirmPlugin(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to uninstall plugin');
        }
    };

    return (
        <PluginsPanelLayout plugins={plugins} isPending={isPending} handleAction={handleAction}
            handleUninstallRequest={handleUninstallRequest} confirmPlugin={confirmPlugin}
            setConfirmPlugin={setConfirmPlugin} handleUninstallConfirm={handleUninstallConfirm}
            uninstallPending={uninstall.isPending} />
    );
}

function PluginsPanelLayout({ plugins, isPending, handleAction, handleUninstallRequest, confirmPlugin, setConfirmPlugin, handleUninstallConfirm, uninstallPending }: {
    plugins: ReturnType<typeof usePluginAdmin>['plugins']; isPending: boolean;
    handleAction: (action: 'install' | 'activate' | 'deactivate', slug: string) => void;
    handleUninstallRequest: (slug: string) => void; confirmPlugin: PluginInfoDto | null;
    setConfirmPlugin: (p: PluginInfoDto | null) => void; handleUninstallConfirm: () => void; uninstallPending: boolean;
}): JSX.Element {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Manage Plugins</h2>
                <p className="text-sm text-muted mt-1">Install and configure plugins to extend functionality.</p>
            </div>
            <PluginsListLoading isLoading={plugins.isLoading} />
            {plugins.data?.map((plugin) => (
                <PluginCard key={plugin.slug} plugin={plugin} isPending={isPending}
                    onInstall={(s) => handleAction('install', s)}
                    onActivate={(s) => handleAction('activate', s)}
                    onDeactivate={(s) => handleAction('deactivate', s)}
                    onUninstall={handleUninstallRequest} />
            ))}
            <PluginsEmptyState show={!plugins.isLoading && plugins.data?.length === 0} />
            <UninstallConfirmModal plugin={confirmPlugin} onClose={() => setConfirmPlugin(null)}
                onConfirm={handleUninstallConfirm} isPending={uninstallPending} />
        </div>
    );
}

function PluginsListLoading({ isLoading }: { isLoading: boolean }): JSX.Element | null {
    if (!isLoading) return null;
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 animate-pulse">
            <div className="h-5 bg-overlay rounded w-40 mb-3" />
            <div className="h-4 bg-overlay rounded w-full mb-2" />
            <div className="h-4 bg-overlay rounded w-3/4" />
        </div>
    );
}

function PluginsEmptyState({ show }: { show: boolean | undefined }): JSX.Element | null {
    if (!show) return null;
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
            <p className="text-muted text-sm">No plugins available.</p>
        </div>
    );
}
