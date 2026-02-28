import { Link } from 'react-router-dom';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { usePluginStore } from '../../stores/plugin-store';
import { toast } from '../../lib/toast';

export function DiscordOverviewPage() {
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

    return <DiscordOverviewContent />;
}

function DiscordOverviewContent() {
    const { discordBotStatus, setupStatus, reconnectBot, sendTestMessage } = useAdminSettings();

    const botData = discordBotStatus.data;
    const setup = setupStatus.data;

    const handleReconnect = () => {
        reconnectBot.mutate(undefined, {
            onSuccess: (data) => {
                if (data.success) toast.success(data.message);
                else toast.error(data.message);
            },
            onError: () => toast.error('Failed to reconnect'),
        });
    };

    const handleTestMessage = () => {
        sendTestMessage.mutate(undefined, {
            onSuccess: (data) => {
                if (data.success) toast.success(data.message);
                else toast.error(data.message);
            },
            onError: (err: Error) => toast.error(err.message),
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Discord Overview</h2>
                <p className="text-sm text-muted mt-1">Setup progress and bot status at a glance.</p>
            </div>

            {/* Setup Progress */}
            <div className="bg-surface border border-edge rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-foreground">Setup Progress</h3>
                    {setup && (
                        <span className="text-sm text-muted">
                            {setup.completedCount}/{setup.totalCount} complete
                        </span>
                    )}
                </div>

                {setup && (
                    <>
                        <div className="w-full bg-overlay rounded-full h-2 mb-4">
                            <div
                                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${(setup.completedCount / setup.totalCount) * 100}%` }}
                            />
                        </div>

                        <div className="space-y-3">
                            {setup.steps.map((step) => (
                                <div key={step.key} className="flex items-center gap-3">
                                    <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                                        step.completed
                                            ? 'bg-emerald-500/20 text-emerald-400'
                                            : 'bg-overlay text-dim'
                                    }`}>
                                        {step.completed ? '✓' : '○'}
                                    </span>
                                    <Link
                                        to={step.settingsPath}
                                        className={`text-sm hover:underline ${
                                            step.completed ? 'text-muted' : 'text-foreground'
                                        }`}
                                    >
                                        {step.label}
                                    </Link>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {setupStatus.isLoading && (
                    <div className="animate-pulse space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-6 bg-overlay rounded" />
                        ))}
                    </div>
                )}
            </div>

            {/* Bot Status Dashboard */}
            <div className="bg-surface border border-edge rounded-xl p-6">
                <h3 className="text-base font-semibold text-foreground mb-4">Bot Status</h3>

                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                        botData?.connecting
                            ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse'
                            : botData?.connected
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                                : 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                    }`} />
                    <div className="flex-1">
                        <span className="text-sm font-medium text-foreground">
                            {botData?.connecting ? 'Starting...' : botData?.connected ? 'Online' : 'Offline'}
                        </span>
                        {botData?.connected && botData.guildName && (
                            <p className="text-xs text-secondary mt-0.5">
                                {botData.guildName}
                                {botData.memberCount != null && (
                                    <span className="text-dim"> &middot; {botData.memberCount} members</span>
                                )}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-surface border border-edge rounded-xl p-6">
                <h3 className="text-base font-semibold text-foreground mb-4">Quick Actions</h3>
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={handleReconnect}
                        disabled={reconnectBot.isPending || !botData?.configured}
                        className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-foreground text-sm font-semibold rounded-lg transition-colors"
                    >
                        {reconnectBot.isPending ? 'Reconnecting...' : 'Reconnect Bot'}
                    </button>
                    <button
                        onClick={handleTestMessage}
                        disabled={sendTestMessage.isPending || !botData?.connected}
                        className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground text-sm font-semibold rounded-lg transition-colors"
                    >
                        {sendTestMessage.isPending ? 'Sending...' : 'Send Test Message'}
                    </button>
                </div>
            </div>
        </div>
    );
}
