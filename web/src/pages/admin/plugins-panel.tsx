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
// eslint-disable-next-line max-lines-per-function
export function PluginsPanel(): JSX.Element {
    const { plugins, install, uninstall, activate, deactivate } = usePluginAdmin();
    const [confirmPlugin, setConfirmPlugin] = useState<PluginInfoDto | null>(null);
    const isPending = install.isPending || uninstall.isPending || activate.isPending || deactivate.isPending;

    const handleAction = async (action: 'install' | 'activate' | 'deactivate', slug: string): Promise<void> => {
        const mutations = { install, activate, deactivate };
        const labels = { install: 'install', activate: 'activate', deactivate: 'deactivate' };
        try {
            await mutations[action].mutateAsync(slug);
            toast.success(`Plugin ${labels[action]}d`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Failed to ${labels[action]} plugin`);
        }
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
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Manage Plugins</h2>
                <p className="text-sm text-muted mt-1">Install and configure plugins to extend functionality.</p>
            </div>

            {plugins.isLoading && (
                <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 animate-pulse">
                    <div className="h-5 bg-overlay rounded w-40 mb-3" />
                    <div className="h-4 bg-overlay rounded w-full mb-2" />
                    <div className="h-4 bg-overlay rounded w-3/4" />
                </div>
            )}

            {plugins.data?.map((plugin) => (
                <PluginCard key={plugin.slug} plugin={plugin} isPending={isPending}
                    onInstall={(s) => handleAction('install', s)}
                    onActivate={(s) => handleAction('activate', s)}
                    onDeactivate={(s) => handleAction('deactivate', s)}
                    onUninstall={handleUninstallRequest} />
            ))}

            {!plugins.isLoading && plugins.data?.length === 0 && (
                <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
                    <p className="text-muted text-sm">No plugins available.</p>
                </div>
            )}

            <UninstallConfirmModal plugin={confirmPlugin} onClose={() => setConfirmPlugin(null)}
                onConfirm={handleUninstallConfirm} isPending={uninstall.isPending} />
        </div>
    );
}
