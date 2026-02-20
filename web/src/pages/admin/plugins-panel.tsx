import { useState } from 'react';
import { toast } from '../../lib/toast';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useNewBadge } from '../../hooks/use-new-badge';
import { getPluginBadge } from '../../plugins/plugin-registry';
import { AdminPluginSection } from '../../components/admin/AdminPluginSection';
import { NewBadge } from '../../components/ui/new-badge';
import { Modal } from '../../components/ui/modal';
import type { PluginInfoDto } from '@raid-ledger/contract';

/**
 * Plugins > Manage Plugins panel.
 * ROK-281 v2: Card-based layout showing full plugin details at a glance.
 * No collapsible sections — all info visible: author, capabilities, game slugs, integrations.
 */
export function PluginsPanel() {
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

    const configuredIntegrations = confirmPlugin?.integrations.filter((i) => i.configured) ?? [];

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
                <PluginCard
                    key={plugin.slug}
                    plugin={plugin}
                    isPending={isPending}
                    onInstall={handleInstall}
                    onActivate={handleActivate}
                    onDeactivate={handleDeactivate}
                    onUninstall={handleUninstallRequest}
                />
            ))}

            {!plugins.isLoading && plugins.data?.length === 0 && (
                <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
                    <p className="text-muted text-sm">No plugins available.</p>
                </div>
            )}

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
        </div>
    );
}

// --- Plugin Card ---

interface PluginCardProps {
    plugin: PluginInfoDto;
    isPending: boolean;
    onInstall: (slug: string) => void;
    onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void;
    onUninstall: (slug: string) => void;
}

function PluginCard({
    plugin,
    isPending,
    onInstall,
    onActivate,
    onDeactivate,
    onUninstall,
}: PluginCardProps) {
    const { isNew, markSeen } = useNewBadge(`plugin-seen:${plugin.slug}`);
    const pluginBadge = getPluginBadge(plugin.slug);

    const actionButtons = (
        <>
            {plugin.status === 'not_installed' && (
                <button
                    onClick={() => onInstall(plugin.slug)}
                    disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                >
                    Install
                </button>
            )}
            {plugin.status === 'active' && (
                <button
                    onClick={() => onDeactivate(plugin.slug)}
                    disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                >
                    Deactivate
                </button>
            )}
            {plugin.status === 'inactive' && (
                <>
                    <button
                        onClick={() => onActivate(plugin.slug)}
                        disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                    >
                        Activate
                    </button>
                    <button
                        onClick={() => onUninstall(plugin.slug)}
                        disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-lg transition-colors border border-red-600/50"
                    >
                        Uninstall
                    </button>
                </>
            )}
        </>
    );

    return (
        <AdminPluginSection
            title={plugin.name}
            version={plugin.version}
            description={plugin.description}
            status={plugin.status}
            badge={<NewBadge visible={isNew} />}
            pluginBadge={pluginBadge}
            onMouseEnter={markSeen}
            actions={actionButtons}
            isPlugin
        >
            {/* Author */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-dim">Author:</span>
                {plugin.author.url ? (
                    <a
                        href={plugin.author.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-secondary hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                        {plugin.author.name}
                    </a>
                ) : (
                    <span className="text-secondary">{plugin.author.name}</span>
                )}
            </div>

            {/* Capabilities */}
            {plugin.capabilities.length > 0 && (
                <div>
                    <span className="text-xs font-medium text-dim uppercase tracking-wider">Capabilities</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {plugin.capabilities.map((cap) => (
                            <span
                                key={cap}
                                className="px-2 py-0.5 text-xs rounded-full bg-overlay text-secondary"
                            >
                                {cap}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Game Slugs */}
            {plugin.gameSlugs.length > 0 && (
                <div>
                    <span className="text-xs font-medium text-dim uppercase tracking-wider">Supported Games</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {plugin.gameSlugs.map((slug) => (
                            <span
                                key={slug}
                                className="px-2 py-0.5 text-xs rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            >
                                {slug}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Integrations */}
            {plugin.integrations.length > 0 && (
                <div>
                    <span className="text-xs font-medium text-dim uppercase tracking-wider">Integrations</span>
                    <div className="mt-1.5 space-y-2">
                        {plugin.integrations.map((integration) => (
                            <div
                                key={integration.key}
                                className="flex items-start gap-3 p-2.5 rounded-lg bg-surface/30 border border-edge/30"
                            >
                                {integration.icon && (
                                    <span className="text-lg flex-shrink-0 mt-0.5">{integration.icon}</span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-foreground">{integration.name}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                            integration.configured
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-gray-500/20 text-gray-400'
                                        }`}>
                                            {integration.configured ? 'Configured' : 'Not Configured'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted mt-0.5">{integration.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Installed date */}
            {plugin.installedAt && (
                <p className="text-xs text-dim">
                    Installed {new Date(plugin.installedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                    })}
                </p>
            )}
        </AdminPluginSection>
    );
}
