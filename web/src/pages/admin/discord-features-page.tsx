import { Link } from 'react-router-dom';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { usePluginStore } from '../../stores/plugin-store';
import { toast } from '../../lib/toast';

export function DiscordFeaturesPage() {
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

    return <DiscordFeaturesContent />;
}

function DiscordFeaturesContent() {
    const { discordBotStatus, adHocEventsStatus, updateAdHocEvents } = useAdminSettings();

    const isBotConnected = discordBotStatus.data?.connected ?? false;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Discord Features</h2>
                <p className="text-sm text-muted mt-1">Toggle Discord bot features and integrations.</p>
            </div>

            {/* Quick Play Events Toggle */}
            {isBotConnected ? (
                <div className="bg-surface rounded-xl border border-edge p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">
                                Quick Play Events
                            </h3>
                            <p className="text-sm text-muted mt-1">
                                Automatically create events when members join bound voice channels.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={adHocEventsStatus.data?.enabled ?? false}
                                onChange={(e) => {
                                    const newEnabled = e.target.checked;
                                    updateAdHocEvents.mutate(
                                        { enabled: newEnabled },
                                        {
                                            onSuccess: () => {
                                                toast.success(
                                                    newEnabled
                                                        ? 'Quick Play Events enabled'
                                                        : 'Quick Play Events disabled',
                                                );
                                            },
                                            onError: () => {
                                                toast.error('Failed to update Quick Play Events setting');
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
            ) : (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                    <p className="text-sm text-amber-400">
                        The Discord bot must be connected to manage features. Configure it on the{' '}
                        <Link to="/admin/settings/discord/connection" className="underline">
                            Connection
                        </Link>{' '}
                        page.
                    </p>
                </div>
            )}

            {/* General Lobby Info */}
            <div className="bg-overlay/30 rounded-lg p-4 border border-border">
                <h3 className="text-sm font-medium text-foreground mb-2">General Lobbies</h3>
                <p className="text-sm text-muted">
                    Voice channels bound without a specific game become General Lobbies — games are
                    auto-detected from Discord Rich Presence. Players can use{' '}
                    <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">/playing</code>{' '}
                    as a manual fallback.
                </p>
                <p className="text-xs text-secondary mt-2">
                    The <em>Allow Just Chatting</em> option is configured per-binding on the{' '}
                    <Link to="/admin/settings/discord/channels" className="text-emerald-400 hover:underline">
                        Channels
                    </Link>{' '}
                    page.
                </p>
            </div>
        </div>
    );
}
