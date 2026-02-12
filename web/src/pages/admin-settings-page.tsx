import { useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useAdminSettings } from '../hooks/use-admin-settings';
import { usePluginAdmin } from '../hooks/use-plugin-admin';
import { useNewBadge } from '../hooks/use-new-badge';
import { IntegrationCard } from '../components/admin/IntegrationCard';
import { AdminPluginSection } from '../components/admin/AdminPluginSection';
import { DiscordOAuthForm } from '../components/admin/DiscordOAuthForm';
import { IgdbForm } from '../components/admin/IgdbForm';
import { DemoDataCard } from '../components/admin/DemoDataCard';
import { RelayHubCard } from '../components/admin/RelayHubCard';
import { NewBadge } from '../components/ui/new-badge';
import { Modal } from '../components/ui/modal';
import { PluginSlot } from '../plugins';
import type { PluginInfoDto } from '@raid-ledger/contract';

// Discord icon
const DiscordIcon = (
    <div className="w-10 h-10 rounded-lg bg-[#5865F2] flex items-center justify-center">
        <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    </div>
);

// Twitch/IGDB icon
const TwitchIcon = (
    <div className="w-10 h-10 rounded-lg bg-[#9146FF] flex items-center justify-center">
        <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
        </svg>
    </div>
);

/**
 * Admin Settings Page — single scrollable page, plugin-centric layout.
 * Core integrations at the top, then real plugins with nested integration cards.
 */
export function AdminSettingsPage() {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const { oauthStatus, igdbStatus } = useAdminSettings();
    const { plugins, install, uninstall, activate, deactivate } = usePluginAdmin();

    const [confirmPlugin, setConfirmPlugin] = useState<PluginInfoDto | null>(null);

    const isPending =
        install.isPending || uninstall.isPending || activate.isPending || deactivate.isPending;

    // Loading state
    if (authLoading) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="animate-pulse">
                    <div className="h-8 bg-overlay rounded w-48 mb-4"></div>
                    <div className="h-4 bg-overlay rounded w-64 mb-8"></div>
                    <div className="bg-panel/50 rounded-xl h-96"></div>
                </div>
            </div>
        );
    }

    // Access control
    if (!user?.isAdmin) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-red-400">Access Denied</h2>
                    <p className="text-muted mt-2">
                        You must be an administrator to access this page.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-4 px-4 py-2 bg-overlay hover:bg-faint rounded-lg text-foreground transition-colors"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    // Plugin action handlers
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
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">Plugins</h1>
                <p className="text-muted">
                    Manage plugins and configure integrations.
                </p>
            </div>

            {/* ===== Core Section ===== */}
            <AdminPluginSection title="Core" isCore>
                {/* Discord OAuth */}
                <IntegrationCard
                    title="Discord OAuth"
                    description="Enable Discord login for users"
                    icon={DiscordIcon}
                    isConfigured={oauthStatus.data?.configured ?? false}
                    isLoading={oauthStatus.isLoading}
                    defaultExpanded={false}
                >
                    <DiscordOAuthForm />
                </IntegrationCard>

                {/* IGDB / Twitch */}
                <IntegrationCard
                    title="IGDB / Twitch"
                    description="Enable game discovery and live streams"
                    icon={TwitchIcon}
                    isConfigured={igdbStatus.data?.configured ?? false}
                    isLoading={igdbStatus.isLoading}
                    defaultExpanded={false}
                >
                    <IgdbForm />
                </IntegrationCard>

                {/* Demo Data */}
                <DemoDataCard />

                {/* Relay Hub (ROK-273) */}
                <RelayHubCard />
            </AdminPluginSection>

            {/* ===== Real Plugins ===== */}
            {plugins.isLoading && (
                <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 animate-pulse">
                    <div className="h-5 bg-overlay rounded w-40 mb-3" />
                    <div className="h-4 bg-overlay rounded w-full mb-2" />
                    <div className="h-4 bg-overlay rounded w-3/4" />
                </div>
            )}

            {plugins.data?.map((plugin) => (
                <PluginSection
                    key={plugin.slug}
                    plugin={plugin}
                    isPending={isPending}
                    onInstall={handleInstall}
                    onActivate={handleActivate}
                    onDeactivate={handleDeactivate}
                    onUninstall={handleUninstallRequest}
                />
            ))}

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

// ─── Plugin Section (extracted for useNewBadge per-plugin) ──────────────────

interface PluginSectionProps {
    plugin: PluginInfoDto;
    isPending: boolean;
    onInstall: (slug: string) => void;
    onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void;
    onUninstall: (slug: string) => void;
}

function PluginSection({
    plugin,
    isPending,
    onInstall,
    onActivate,
    onDeactivate,
    onUninstall,
}: PluginSectionProps) {
    const { isNew, markSeen } = useNewBadge(`plugin-seen:${plugin.slug}`);

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
            status={plugin.status}
            badge={<NewBadge visible={isNew} />}
            onMouseEnter={markSeen}
            actions={actionButtons}
            defaultExpanded={plugin.status === 'active'}
        >
            {plugin.status === 'active' ? (
                <PluginSlot
                    name="admin-settings:plugin-content"
                    context={{ pluginSlug: plugin.slug }}
                />
            ) : (
                <p className="text-sm text-muted py-2">
                    {plugin.status === 'inactive'
                        ? 'Activate this plugin to configure its integrations.'
                        : 'Install this plugin to get started.'}
                </p>
            )}
        </AdminPluginSection>
    );
}
