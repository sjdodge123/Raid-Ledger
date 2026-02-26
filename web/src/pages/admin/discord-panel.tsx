import { useState } from 'react';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useAuth } from '../../hooks/use-auth';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { isDiscordLinked } from '../../lib/avatar';
import { API_BASE_URL } from '../../lib/config';
import { toast } from '../../lib/toast';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { DiscordOAuthForm } from '../../components/admin/DiscordOAuthForm';
import { DiscordBotForm } from '../../components/admin/DiscordBotForm';
import { ChannelBindingList } from '../../components/admin/ChannelBindingList';
import type { UpdateChannelBindingDto } from '@raid-ledger/contract';

/* ------------------------------------------------------------------ */

const DiscordIcon = (
    <div className="w-10 h-10 rounded-lg bg-[#5865F2] flex items-center justify-center">
        <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    </div>
);

type DiscordTab = 'auth' | 'bot' | 'bindings';

interface TabDef {
    id: DiscordTab;
    label: string;
    status?: 'online' | 'offline' | 'loading';
}

/**
 * Integrations > Discord panel — tabbed layout with status dots.
 * ROK-359: Consolidated OAuth + Bot + Channel Bindings with tab navigation.
 */
export function DiscordPanel() {
    const [activeTab, setActiveTab] = useState<DiscordTab>('auth');
    const { oauthStatus, discordBotStatus, discordChannels, discordDefaultChannel, setDiscordChannel, adHocEventsStatus, updateAdHocEvents } = useAdminSettings();
    const { user } = useAuth();
    const { bindings, updateBinding, deleteBinding } = useChannelBindings();

    const hasDiscord = isDiscordLinked(user?.discordId);
    const isBotConnected = discordBotStatus.data?.connected ?? false;
    const isBotConfigured = discordBotStatus.data?.configured ?? false;

    const tabs: TabDef[] = [
        {
            id: 'auth',
            label: 'Authentication',
            status: oauthStatus.isLoading ? 'loading'
                : (oauthStatus.data?.configured ?? false) ? 'online' : 'offline',
        },
        {
            id: 'bot',
            label: 'Bot',
            status: discordBotStatus.isLoading ? 'loading'
                : isBotConnected ? 'online' : 'offline',
        },
        {
            id: 'bindings',
            label: 'Channel Bindings',
        },
    ];

    const handleLinkDiscord = () => {
        const token = localStorage.getItem('raid_ledger_token');
        if (!token) {
            toast.error('Please log in again to link Discord');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
    };

    const handleUpdateBinding = (id: string, dto: UpdateChannelBindingDto) => {
        updateBinding.mutate(
            { id, dto },
            {
                onSuccess: () => toast.success('Binding updated'),
                onError: (err: Error) => toast.error(err.message),
            },
        );
    };

    const handleDeleteBinding = (id: string) => {
        deleteBinding.mutate(id, {
            onSuccess: () => toast.success('Binding removed'),
            onError: (err: Error) => toast.error(err.message),
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Discord</h2>
                <p className="text-sm text-muted mt-1">Manage authentication, bot, and channel bindings.</p>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-edge/50">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                            activeTab === tab.id
                                ? 'text-emerald-400 border-emerald-400'
                                : 'text-muted hover:text-foreground border-transparent'
                        }`}
                    >
                        {tab.status && tab.status !== 'loading' && (
                            <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                    tab.status === 'online' ? 'bg-emerald-400' : 'bg-red-400'
                                }`}
                            />
                        )}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {activeTab === 'auth' && (
                <IntegrationCard
                    title="Discord OAuth"
                    description="Enable Discord login for users"
                    icon={DiscordIcon}
                    isConfigured={oauthStatus.data?.configured ?? false}
                    isLoading={oauthStatus.isLoading}
                >
                    <DiscordOAuthForm />
                </IntegrationCard>
            )}

            {activeTab === 'bot' && (
                <>
                    {!hasDiscord ? (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6">
                            <div className="flex items-start gap-4">
                                {DiscordIcon}
                                <div className="flex-1">
                                    <h3 className="text-base font-semibold text-foreground">Discord Account Required</h3>
                                    <p className="text-sm text-muted mt-1">
                                        You need to link a Discord account before configuring the bot.
                                        Without a linked account, the bot cannot send you DMs or complete the setup wizard.
                                    </p>
                                    <button
                                        onClick={handleLinkDiscord}
                                        className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                        </svg>
                                        Link Discord Account
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <IntegrationCard
                                title="Discord Bot"
                                description="Enable bot features for notifications and event management"
                                icon={DiscordIcon}
                                isConfigured={isBotConfigured}
                                isLoading={discordBotStatus.isLoading}
                            >
                                <DiscordBotForm />
                            </IntegrationCard>

                            {/* ROK-293: Ad-Hoc Events Toggle */}
                            {isBotConnected && (
                                <div className="bg-surface rounded-xl border border-edge p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-base font-semibold text-foreground">
                                                Ad-Hoc Voice Events
                                            </h3>
                                            <p className="text-sm text-muted mt-1">
                                                Automatically create events when members join bound voice channels.
                                                Disabled by default.
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={adHocEventsStatus.data?.enabled ?? false}
                                                onChange={(e) => {
                                                    updateAdHocEvents.mutate(
                                                        { enabled: e.target.checked },
                                                        {
                                                            onSuccess: () => {
                                                                toast.success(
                                                                    e.target.checked
                                                                        ? 'Ad-hoc events enabled'
                                                                        : 'Ad-hoc events disabled',
                                                                );
                                                            },
                                                            onError: () => {
                                                                toast.error('Failed to update ad-hoc events setting');
                                                            },
                                                        },
                                                    );
                                                }}
                                                disabled={updateAdHocEvents.isPending}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-dim rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                                        </label>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {activeTab === 'bindings' && (
                <div className="space-y-4">
                    <p className="text-sm text-muted">
                        Map Discord channels to games for smart event routing. Use{' '}
                        <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">
                            /bind
                        </code>{' '}
                        in Discord for quick setup, or manage bindings here.
                    </p>

                    {!isBotConnected && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                            <p className="text-sm text-amber-400">
                                The Discord bot is not connected. Configure it in the Bot tab to manage channel bindings.
                            </p>
                        </div>
                    )}

                    {/* Default Notification Channel (fallback) */}
                    {isBotConnected && discordChannels.data && discordChannels.data.length > 0 && (
                        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                            <label htmlFor="discordChannel" className="block text-sm font-medium text-secondary mb-1.5">
                                Default Notification Channel
                            </label>
                            <select
                                id="discordChannel"
                                value={discordDefaultChannel.data?.channelId ?? ''}
                                onChange={async (e) => {
                                    if (e.target.value) {
                                        try {
                                            await setDiscordChannel.mutateAsync(e.target.value);
                                            toast.success('Default channel updated');
                                        } catch {
                                            toast.error('Failed to update default channel');
                                        }
                                    }
                                }}
                                disabled={setDiscordChannel.isPending}
                                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            >
                                <option value="" disabled>Select a channel...</option>
                                {discordChannels.data.map((ch: { id: string; name: string }) => (
                                    <option key={ch.id} value={ch.id}>#{ch.name}</option>
                                ))}
                            </select>
                            <p className="text-xs text-secondary mt-1.5">Fallback channel for event embeds when no game-specific binding is set</p>
                        </div>
                    )}

                    {/* Routing priority info */}
                    <div className="bg-overlay/30 rounded-lg p-4 border border-border">
                        <h3 className="text-sm font-medium text-foreground mb-2">
                            Event Routing Priority
                        </h3>
                        <ol className="list-decimal list-inside text-sm text-muted space-y-1">
                            <li>
                                <span className="text-foreground">Game-specific binding</span> — posts to the bound channel for that game
                            </li>
                            <li>
                                <span className="text-foreground">Default text channel</span> — falls back to the channel set in bot settings
                            </li>
                            <li>
                                <span className="text-foreground">No channel</span> — event page shows a warning
                            </li>
                        </ol>
                    </div>

                    {bindings.isLoading ? (
                        <div className="animate-pulse space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-16 bg-overlay rounded-lg" />
                            ))}
                        </div>
                    ) : bindings.isError ? (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                            <p className="text-sm text-red-400">
                                Failed to load bindings: {bindings.error.message}
                            </p>
                        </div>
                    ) : (
                        <ChannelBindingList
                            bindings={bindings.data?.data ?? []}
                            onUpdate={handleUpdateBinding}
                            onDelete={handleDeleteBinding}
                            isUpdating={updateBinding.isPending}
                            isDeleting={deleteBinding.isPending}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
