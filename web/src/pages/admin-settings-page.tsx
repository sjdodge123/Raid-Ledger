import type { JSX } from 'react';
import { useState } from 'react';
import { toast } from '../lib/toast';
import { useNavigate } from 'react-router-dom';
import { useAuth, isAdmin as isAdminCheck } from '../hooks/use-auth';
import { useAdminSettings } from '../hooks/use-admin-settings';
import { usePluginAdmin } from '../hooks/use-plugin-admin';
import { useNewBadge } from '../hooks/use-new-badge';
import { IntegrationCard } from '../components/admin/IntegrationCard';
import { AdminPluginSection } from '../components/admin/AdminPluginSection';
import { DiscordOAuthForm } from '../components/admin/DiscordOAuthForm';
import { IgdbForm } from '../components/admin/IgdbForm';
import { SteamForm } from '../components/admin/SteamForm';
import { DemoDataCard } from '../components/admin/DemoDataCard';
import { RoleManagementCard } from '../components/admin/RoleManagementCard';
import { NewBadge } from '../components/ui/new-badge';
import { PluginSlot, getPluginBadge } from '../plugins';
import { UpdateBanner } from '../components/admin/UpdateBanner';
import type { PluginInfoDto } from '@raid-ledger/contract';
import { DiscordIcon, SteamIconWrapped, TwitchIcon } from './admin-settings/admin-settings-icons';
import { UninstallConfirmModal } from './admin-settings/UninstallConfirmModal';

/**
 * Admin Settings Page — single scrollable page, plugin-centric layout.
 * Core integrations at the top, then real plugins with nested integration cards.
 */
async function executePluginAction(mutations: { install: { mutateAsync: (s: string) => Promise<void> }; activate: { mutateAsync: (s: string) => Promise<void> }; deactivate: { mutateAsync: (s: string) => Promise<void> } }, action: 'install' | 'activate' | 'deactivate', slug: string): Promise<void> {
    const labels = { install: 'install', activate: 'activate', deactivate: 'deactivate' };
    try {
        await mutations[action].mutateAsync(slug);
        toast.success(`Plugin ${labels[action]}d`);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${labels[action]} plugin`);
    }
}

export function AdminSettingsPage(): JSX.Element {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const { plugins, install, uninstall, activate, deactivate } = usePluginAdmin();
    const [confirmPlugin, setConfirmPlugin] = useState<PluginInfoDto | null>(null);
    const isPending = install.isPending || uninstall.isPending || activate.isPending || deactivate.isPending;

    if (authLoading) return <AdminSettingsLoading />;
    if (!isAdminCheck(user)) return <AdminAccessDenied onGoHome={() => navigate('/')} />;

    const handleAction = (action: 'install' | 'activate' | 'deactivate', slug: string): void => {
        void executePluginAction({ install, activate, deactivate }, action, slug);
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
        <AdminSettingsLayout user={user} plugins={plugins} isPending={isPending}
            confirmPlugin={confirmPlugin} setConfirmPlugin={setConfirmPlugin}
            handleAction={handleAction} handleUninstallConfirm={handleUninstallConfirm}
            uninstallPending={uninstall.isPending} />
    );
}

function AdminSettingsLoading(): JSX.Element {
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

function AdminAccessDenied({ onGoHome }: { onGoHome: () => void }): JSX.Element {
    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-red-400">Access Denied</h2>
                <p className="text-muted mt-2">You must be an administrator to access this page.</p>
                <button onClick={onGoHome} className="mt-4 px-4 py-2 bg-overlay hover:bg-faint rounded-lg text-foreground transition-colors">Go Home</button>
            </div>
        </div>
    );
}

function AdminSettingsLayout({ user, plugins, isPending, confirmPlugin, setConfirmPlugin, handleAction, handleUninstallConfirm, uninstallPending }: {
    user: ReturnType<typeof useAuth>['user']; plugins: ReturnType<typeof usePluginAdmin>['plugins'];
    isPending: boolean; confirmPlugin: PluginInfoDto | null; setConfirmPlugin: (p: PluginInfoDto | null) => void;
    handleAction: (action: 'install' | 'activate' | 'deactivate', slug: string) => void;
    handleUninstallConfirm: () => void; uninstallPending: boolean;
}): JSX.Element {
    return (
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
            <UpdateBanner enabled={isAdminCheck(user)} />
            <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">Plugins</h1>
                <p className="text-muted">Manage plugins and configure integrations.</p>
            </div>
            <CoreIntegrationsSection />
            <PluginsLoadingState isLoading={plugins.isLoading} />
            {plugins.data?.map((plugin) => (
                <PluginSection key={plugin.slug} plugin={plugin} isPending={isPending}
                    onInstall={(s) => handleAction('install', s)} onActivate={(s) => handleAction('activate', s)}
                    onDeactivate={(s) => handleAction('deactivate', s)}
                    onUninstall={(s) => { const p = plugins.data?.find((x) => x.slug === s); if (p) setConfirmPlugin(p); }} />
            ))}
            <UninstallConfirmModal plugin={confirmPlugin} onClose={() => setConfirmPlugin(null)} onConfirm={handleUninstallConfirm} isPending={uninstallPending} />
        </div>
    );
}

function CoreIntegrationsSection(): JSX.Element {
    const { oauthStatus, igdbStatus, steamStatus } = useAdminSettings();
    return (
        <AdminPluginSection title="Core" description="Built-in integrations and settings">
            <IntegrationCard title="Discord OAuth" description="Enable Discord login for users" icon={DiscordIcon} isConfigured={oauthStatus.data?.configured ?? false} isLoading={oauthStatus.isLoading}><DiscordOAuthForm /></IntegrationCard>
            <IntegrationCard title="IGDB / Twitch" description="Enable game discovery and live streams" icon={TwitchIcon} isConfigured={igdbStatus.data?.configured ?? false} isLoading={igdbStatus.isLoading}><IgdbForm /></IntegrationCard>
            <IntegrationCard title="Steam" description="Link Steam accounts for library and playtime sync" icon={SteamIconWrapped} isConfigured={steamStatus.data?.configured ?? false} isLoading={steamStatus.isLoading}><SteamForm /></IntegrationCard>
            <DemoDataCard />
            <RoleManagementCard />
        </AdminPluginSection>
    );
}

function PluginsLoadingState({ isLoading }: { isLoading: boolean }): JSX.Element | null {
    if (!isLoading) return null;
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 animate-pulse">
            <div className="h-5 bg-overlay rounded w-40 mb-3" />
            <div className="h-4 bg-overlay rounded w-full mb-2" />
            <div className="h-4 bg-overlay rounded w-3/4" />
        </div>
    );
}

/** Plugin section wrapper with action buttons */
function PluginSection({ plugin, isPending, onInstall, onActivate, onDeactivate, onUninstall }: {
    plugin: PluginInfoDto; isPending: boolean;
    onInstall: (s: string) => void; onActivate: (s: string) => void;
    onDeactivate: (s: string) => void; onUninstall: (s: string) => void;
}): JSX.Element {
    const { isNew, markSeen } = useNewBadge(`plugin-seen:${plugin.slug}`);
    const pluginBadge = getPluginBadge(plugin.slug);
    const actionButtons = <PluginActionButtons plugin={plugin} isPending={isPending} onInstall={onInstall} onActivate={onActivate} onDeactivate={onDeactivate} onUninstall={onUninstall} />;

    return (
        <AdminPluginSection title={plugin.name} version={plugin.version} status={plugin.status}
            badge={<NewBadge visible={isNew} />} pluginBadge={pluginBadge} onMouseEnter={markSeen}
            actions={actionButtons} description={plugin.description ?? ''}>
            {plugin.status === 'active' ? (
                <PluginSlot name="admin-settings:plugin-content" context={{ pluginSlug: plugin.slug }} />
            ) : (
                <p className="text-sm text-muted py-2">
                    {plugin.status === 'inactive' ? 'Activate this plugin to configure its integrations.' : 'Install this plugin to get started.'}
                </p>
            )}
        </AdminPluginSection>
    );
}

function PluginActionButtons({ plugin, isPending, onInstall, onActivate, onDeactivate, onUninstall }: {
    plugin: PluginInfoDto; isPending: boolean;
    onInstall: (s: string) => void; onActivate: (s: string) => void;
    onDeactivate: (s: string) => void; onUninstall: (s: string) => void;
}): JSX.Element {
    return (
        <>
            {plugin.status === 'not_installed' && (
                <button onClick={() => onInstall(plugin.slug)} disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Install</button>
            )}
            {plugin.status === 'active' && (
                <button onClick={() => onDeactivate(plugin.slug)} disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Deactivate</button>
            )}
            {plugin.status === 'inactive' && (
                <>
                    <button onClick={() => onActivate(plugin.slug)} disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Activate</button>
                    <button onClick={() => onUninstall(plugin.slug)} disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-lg transition-colors border border-red-600/50">Uninstall</button>
                </>
            )}
        </>
    );
}
