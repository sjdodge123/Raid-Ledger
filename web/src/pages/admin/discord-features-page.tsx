import { Link } from 'react-router-dom';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { usePluginStore } from '../../stores/plugin-store';
import { toast } from '../../lib/toast';
import { Switch } from '../../components/ui/switch';
import { EphemeralVoiceSection } from './ephemeral-voice-section';
import { LfgBoardSection } from './lfg-board-section';
import { WeeklyDigestSection } from './weekly-digest-section';

export function DiscordFeaturesPage() {
    const isDiscordActive = usePluginStore((s) => s.isPluginActive('discord'));

    if (!isDiscordActive) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="bg-surface border border-edge rounded-xl p-8 max-w-md text-center">
                    <p className="text-foreground font-medium">The Discord plugin is not active.</p>
                    <p className="text-sm text-muted mt-2">
                        Enable it in{' '}
                        <Link to="/admin/settings/plugins" className="text-success hover:underline">
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

    const handleToggle = (checked: boolean) => {
        updateAdHocEvents.mutate(
            { enabled: checked },
            {
                onSuccess: () => toast.success(checked ? 'Quick Play Events enabled' : 'Quick Play Events disabled'),
                onError: () => toast.error('Failed to update Quick Play Events setting'),
            },
        );
    };

    return (
        <div className="space-y-6">
            <FeaturesHeader />
            {isBotConnected ? (
                <>
                    <QuickPlayToggle checked={adHocEventsStatus.data?.enabled ?? false} isPending={updateAdHocEvents.isPending} onToggle={handleToggle} />
                    <EphemeralVoiceSection />
                    <LfgBoardSection />
                    <WeeklyDigestSection />
                </>
            ) : (
                <BotNotConnectedWarning />
            )}
            <GeneralLobbyInfo />
        </div>
    );
}

function FeaturesHeader() {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">Discord Features</h2>
            <p className="text-sm text-muted mt-1">Toggle Discord bot features and integrations.</p>
        </div>
    );
}

function QuickPlayToggle({ checked, isPending, onToggle }: { checked: boolean; isPending: boolean; onToggle: (v: boolean) => void }) {
    return (
        <div className="bg-surface rounded-xl border border-edge p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground">Quick Play Events</h3>
                    <p className="text-sm text-muted mt-1">Automatically create events when members join bound voice channels.</p>
                </div>
                <Switch label="Enable Quick Play Events" checked={checked}
                    disabled={isPending} onChange={onToggle} />
            </div>
        </div>
    );
}

function BotNotConnectedWarning() {
    return (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">
                The Discord bot must be connected to manage features. Configure it on the{' '}
                <Link to="/admin/settings/discord/connection" className="underline">Connection</Link> page.
            </p>
        </div>
    );
}

function GeneralLobbyInfo() {
    return (
        <div className="bg-overlay/30 rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-medium text-foreground mb-2">General Lobbies</h3>
            <p className="text-sm text-muted">
                Voice channels bound without a specific game become General Lobbies — games are
                auto-detected from Discord Rich Presence. Players can use{' '}
                <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">/playing</code>{' '}
                as a manual fallback.
            </p>
            <p className="text-xs text-secondary mt-2">
                The <em>Allow Just Chatting</em> option is configured per-binding on the{' '}
                <Link to="/admin/settings/discord/channels" className="text-success hover:underline">Channels</Link> page.
            </p>
        </div>
    );
}
