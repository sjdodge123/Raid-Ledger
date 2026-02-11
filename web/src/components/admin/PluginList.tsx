import { useState } from 'react';
import { toast } from 'sonner';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { PluginCard } from './PluginCard';
import { Modal } from '../ui/modal';
import type { PluginInfoDto } from '@raid-ledger/contract';

export function PluginList() {
    const { plugins, install, uninstall, activate, deactivate } = usePluginAdmin();
    const [confirmPlugin, setConfirmPlugin] = useState<PluginInfoDto | null>(null);

    const isPending =
        install.isPending || uninstall.isPending || activate.isPending || deactivate.isPending;

    const handleInstall = async (slug: string) => {
        try {
            await install.mutateAsync(slug);
            toast.success('Plugin installed');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to install plugin');
        }
    };

    const handleActivate = async (slug: string) => {
        try {
            await activate.mutateAsync(slug);
            toast.success('Plugin activated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to activate plugin');
        }
    };

    const handleDeactivate = async (slug: string) => {
        try {
            await deactivate.mutateAsync(slug);
            toast.success('Plugin deactivated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to deactivate plugin');
        }
    };

    const handleUninstallRequest = (slug: string) => {
        const plugin = plugins.data?.find((p) => p.slug === slug);
        if (plugin) setConfirmPlugin(plugin);
    };

    const handleUninstallConfirm = async () => {
        if (!confirmPlugin) return;
        try {
            await uninstall.mutateAsync(confirmPlugin.slug);
            toast.success('Plugin uninstalled');
            setConfirmPlugin(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to uninstall plugin');
        }
    };

    // Loading skeleton
    if (plugins.isLoading) {
        return (
            <div className="space-y-4">
                {[1, 2].map((i) => (
                    <div
                        key={i}
                        className="bg-panel/50 rounded-xl border border-edge/50 p-5 animate-pulse"
                    >
                        <div className="h-5 bg-overlay rounded w-40 mb-3" />
                        <div className="h-4 bg-overlay rounded w-24 mb-3" />
                        <div className="h-4 bg-overlay rounded w-full mb-2" />
                        <div className="h-4 bg-overlay rounded w-3/4" />
                    </div>
                ))}
            </div>
        );
    }

    // Empty state
    if (!plugins.data?.length) {
        return (
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-8 text-center">
                <p className="text-muted">No plugins registered.</p>
                <p className="text-sm text-dim mt-1">
                    Plugins are discovered automatically from the server's plugin modules.
                </p>
            </div>
        );
    }

    const configuredIntegrations = confirmPlugin?.integrations.filter((i) => i.configured) ?? [];

    return (
        <>
            <div className="space-y-4">
                {plugins.data.map((plugin) => (
                    <PluginCard
                        key={plugin.slug}
                        plugin={plugin}
                        onInstall={handleInstall}
                        onUninstall={handleUninstallRequest}
                        onActivate={handleActivate}
                        onDeactivate={handleDeactivate}
                        isPending={isPending}
                    />
                ))}
            </div>

            {/* Uninstall confirmation modal */}
            <Modal
                isOpen={!!confirmPlugin}
                onClose={() => setConfirmPlugin(null)}
                title="Uninstall Plugin"
            >
                <div className="space-y-4">
                    <p className="text-secondary">
                        Are you sure you want to uninstall{' '}
                        <strong className="text-foreground">{confirmPlugin?.name}</strong>?
                    </p>

                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-400 font-medium mb-1">
                            This action will permanently delete:
                        </p>
                        <ul className="text-sm text-red-400/80 list-disc list-inside space-y-0.5">
                            <li>All plugin settings and saved configuration</li>
                            <li>Integration credentials stored for this plugin</li>
                        </ul>
                    </div>

                    {configuredIntegrations.length > 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                            <p className="text-sm text-amber-400 font-medium mb-1">
                                Configured integrations that will lose credentials:
                            </p>
                            <ul className="text-sm text-amber-400/80 list-disc list-inside space-y-0.5">
                                {configuredIntegrations.map((i) => (
                                    <li key={i.key}>{i.name}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => setConfirmPlugin(null)}
                            className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleUninstallConfirm}
                            disabled={uninstall.isPending}
                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                        >
                            {uninstall.isPending ? 'Uninstalling...' : 'Uninstall'}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
