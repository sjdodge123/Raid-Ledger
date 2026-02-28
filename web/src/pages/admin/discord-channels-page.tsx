import { Link } from 'react-router-dom';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { usePluginStore } from '../../stores/plugin-store';
import { toast } from '../../lib/toast';
import { ChannelBindingList } from '../../components/admin/ChannelBindingList';
import type { UpdateChannelBindingDto } from '@raid-ledger/contract';

export function DiscordChannelsPage() {
    const isDiscordActive = usePluginStore((s) => s.isPluginActive('discord'));

    if (!isDiscordActive) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="bg-surface border border-edge rounded-xl p-8 max-w-md text-center">
                    <p className="text-foreground font-medium">The Discord plugin is not active.</p>
                    <p className="text-sm text-muted mt-2">
                        Enable it in{' '}
                        <Link to="/admin/settings/plugins" className="text-emerald-400 hover:underline">
                            Manage Plugins
                        </Link>{' '}
                        to configure Discord.
                    </p>
                </div>
            </div>
        );
    }

    return <DiscordChannelsContent />;
}

function DiscordChannelsContent() {
    const {
        discordBotStatus,
        discordChannels,
        discordDefaultChannel,
        setDiscordChannel,
        discordVoiceChannels,
        discordDefaultVoiceChannel,
        setDiscordVoiceChannel,
    } = useAdminSettings();
    const { bindings, updateBinding, deleteBinding } = useChannelBindings();

    const isBotConnected = discordBotStatus.data?.connected ?? false;

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
                <h2 className="text-xl font-semibold text-foreground">Discord Channels</h2>
                <p className="text-sm text-muted mt-1">
                    Configure default channels and game-specific bindings.
                </p>
            </div>

            {!isBotConnected && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                    <p className="text-sm text-amber-400">
                        The Discord bot is not connected. Configure it on the{' '}
                        <Link to="/admin/settings/discord/connection" className="underline">
                            Connection
                        </Link>{' '}
                        page to manage channels.
                    </p>
                </div>
            )}

            {/* Default Notification Channel */}
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

            {/* Default Voice Channel */}
            {isBotConnected && discordVoiceChannels.data && discordVoiceChannels.data.length > 0 && (
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <label htmlFor="discordVoiceChannel" className="block text-sm font-medium text-secondary mb-1.5">
                        Default Voice Channel
                    </label>
                    <select
                        id="discordVoiceChannel"
                        value={discordDefaultVoiceChannel.data?.channelId ?? ''}
                        onChange={async (e) => {
                            if (e.target.value) {
                                try {
                                    await setDiscordVoiceChannel.mutateAsync(e.target.value);
                                    toast.success('Default voice channel updated');
                                } catch {
                                    toast.error('Failed to update default voice channel');
                                }
                            }
                        }}
                        disabled={setDiscordVoiceChannel.isPending}
                        className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    >
                        <option value="" disabled>Select a voice channel...</option>
                        {discordVoiceChannels.data.map((ch: { id: string; name: string }) => (
                            <option key={ch.id} value={ch.id}>{ch.name}</option>
                        ))}
                    </select>
                    <p className="text-xs text-secondary mt-1.5">Fallback voice channel for Discord Scheduled Events when no game-specific voice binding is set</p>
                </div>
            )}

            {/* Routing Priority */}
            <div className="bg-overlay/30 rounded-lg p-4 border border-border">
                <h3 className="text-sm font-medium text-foreground mb-2">Event Routing Priority</h3>
                <ol className="list-decimal list-inside text-sm text-muted space-y-1">
                    <li>
                        <span className="text-foreground">Game-specific binding</span> — posts to the bound channel for that game
                    </li>
                    <li>
                        <span className="text-foreground">Default text channel</span> — falls back to the channel set above
                    </li>
                    <li>
                        <span className="text-foreground">No channel</span> — event page shows a warning
                    </li>
                </ol>
            </div>

            {/* Channel Bindings */}
            <div>
                <p className="text-sm text-muted mb-4">
                    Map Discord channels to games for smart event routing. Use{' '}
                    <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">/bind</code>{' '}
                    in Discord for quick setup, or manage bindings here.
                </p>

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
        </div>
    );
}
