import { Link } from 'react-router-dom';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { usePluginStore } from '../../stores/plugin-store';
import { toast } from '../../lib/toast';
import { ChannelBindingList } from '../../components/admin/ChannelBindingList';
import { BindingCreateForm, type BindingChannelOption } from '../../components/admin/BindingCreateForm';
import type { UpdateChannelBindingDto, CreateChannelBindingDto } from '@raid-ledger/contract';

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

function useBindingHandlers() {
    const { bindings, createBinding, updateBinding, deleteBinding } = useChannelBindings();
    // Return the mutation promise so the list collapses the row only on success
    // (a rejected PATCH keeps the edit form open with its error) — ROK-1416.
    const handleUpdate = (id: string, dto: UpdateChannelBindingDto) =>
        updateBinding.mutateAsync({ id, dto })
            .then((r) => { toast.success('Binding updated'); return r; })
            .catch((err: Error) => { toast.error(err.message); throw err; });
    const handleCreate = (dto: CreateChannelBindingDto) =>
        createBinding.mutateAsync(dto)
            .then((r) => { toast.success('Binding created'); return r; })
            .catch((err: Error) => { toast.error(err.message); throw err; });
    const handleDelete = (id: string) => {
        deleteBinding.mutate(id, { onSuccess: () => toast.success('Binding removed'), onError: (err: Error) => toast.error(err.message) });
    };
    return {
        bindings, handleUpdate, handleCreate, handleDelete,
        isUpdating: updateBinding.isPending, isDeleting: deleteBinding.isPending, isCreating: createBinding.isPending,
        updateError: updateBinding.error?.message ?? null, createError: createBinding.error?.message ?? null,
    };
}

function useBindingChannelOptions(settings: ReturnType<typeof useAdminSettings>): BindingChannelOption[] {
    return [
        ...(settings.discordChannels.data ?? []).map((c) => ({ ...c, channelType: 'text' as const })),
        ...(settings.discordVoiceChannels.data ?? []).map((c) => ({ ...c, channelType: 'voice' as const })),
    ];
}

function TextChannelSelector({ settings }: { settings: ReturnType<typeof useAdminSettings> }) {
    const { discordChannels, discordDefaultChannel, setDiscordChannel } = settings;
    if (!discordChannels.data?.length) return null;
    return <ChannelSelector id="discordChannel" label="Default Notification Channel" channels={discordChannels.data}
        value={discordDefaultChannel.data?.channelId ?? ''} isPending={setDiscordChannel.isPending} prefix="#"
        hint="Fallback channel for event embeds when no game-specific binding is set"
        onChange={async (v) => { await setDiscordChannel.mutateAsync(v); toast.success('Default channel updated'); }}
        onError={() => toast.error('Failed to update default channel')} />;
}

function VoiceChannelSelector({ settings }: { settings: ReturnType<typeof useAdminSettings> }) {
    const { discordVoiceChannels, discordDefaultVoiceChannel, setDiscordVoiceChannel } = settings;
    if (!discordVoiceChannels.data?.length) return null;
    return <ChannelSelector id="discordVoiceChannel" label="Default Voice Channel" channels={discordVoiceChannels.data}
        value={discordDefaultVoiceChannel.data?.channelId ?? ''} isPending={setDiscordVoiceChannel.isPending} prefix=""
        hint="Fallback voice channel for Discord Scheduled Events when no game-specific voice binding is set"
        onChange={async (v) => { await setDiscordVoiceChannel.mutateAsync(v); toast.success('Default voice channel updated'); }}
        onError={() => toast.error('Failed to update default voice channel')} />;
}

function LineupChannelSelector({ settings }: { settings: ReturnType<typeof useAdminSettings> }) {
    const { discordChannels, discordLineupChannel, setDiscordLineupChannel } = settings;
    if (!discordChannels.data?.length) return null;
    return <ChannelSelector id="discordLineupChannel" label="Lineup Channel" channels={discordChannels.data}
        value={discordLineupChannel.data?.channelId ?? ''} isPending={setDiscordLineupChannel.isPending} prefix="#"
        hint="Dedicated channel for Community Lineup embeds. Falls back to the default notification channel if not set."
        onChange={async (v) => { await setDiscordLineupChannel.mutateAsync(v); toast.success('Lineup channel updated'); }}
        onError={() => toast.error('Failed to update lineup channel')} />;
}

function DiscordChannelsContent() {
    const settings = useAdminSettings();
    const isBotConnected = settings.discordBotStatus.data?.connected ?? false;
    const handlers = useBindingHandlers();
    const channels = useBindingChannelOptions(settings);

    return (
        <div className="space-y-6">
            <div><h2 className="text-xl font-semibold text-foreground">Discord Channels</h2>
                <p className="text-sm text-muted mt-1">Configure default channels and game-specific bindings.</p></div>
            {!isBotConnected && <ChannelsBotWarning />}
            {isBotConnected && <TextChannelSelector settings={settings} />}
            {isBotConnected && <VoiceChannelSelector settings={settings} />}
            {isBotConnected && <LineupChannelSelector settings={settings} />}
            <RoutingPriorityInfo />
            <ChannelBindingsSection handlers={handlers} channels={channels} />
        </div>
    );
}

function ChannelsBotWarning() {
    return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <p className="text-sm text-amber-400">
                The Discord bot is not connected. Configure it on the{' '}
                <Link to="/admin/settings/discord/connection" className="underline">Connection</Link> page to manage channels.
            </p>
        </div>
    );
}

function ChannelSelector({ id, label, channels, value, isPending, prefix, hint, onChange, onError }: {
    id: string; label: string; channels: { id: string; name: string }[];
    value: string; isPending: boolean; prefix: string; hint: string;
    onChange: (v: string) => Promise<void>; onError: () => void;
}) {
    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <label htmlFor={id} className="block text-sm font-medium text-secondary mb-1.5">{label}</label>
            <select id={id} value={value} disabled={isPending}
                onChange={async (e) => { if (e.target.value) { try { await onChange(e.target.value); } catch { onError(); } } }}
                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all">
                <option value="" disabled>Select a channel...</option>
                {channels.map((ch) => <option key={ch.id} value={ch.id}>{prefix}{ch.name}</option>)}
            </select>
            <p className="text-xs text-secondary mt-1.5">{hint}</p>
        </div>
    );
}

function RoutingPriorityInfo() {
    return (
        <div className="bg-overlay/30 rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-medium text-foreground mb-2">Event Routing Priority</h3>
            <ol className="list-decimal list-inside text-sm text-muted space-y-1">
                <li><span className="text-foreground">Game-specific binding</span> — posts to the bound channel for that game</li>
                <li><span className="text-foreground">Default text channel</span> — falls back to the channel set above</li>
                <li><span className="text-foreground">No channel</span> — event page shows a warning</li>
            </ol>
        </div>
    );
}

function ChannelBindingsSection({ handlers, channels }: {
    handlers: ReturnType<typeof useBindingHandlers>;
    channels: BindingChannelOption[];
}) {
    const { bindings } = handlers;
    return (
        <div>
            <p className="text-sm text-muted mb-4">
                Map Discord channels to games for smart event routing. Use{' '}
                <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">/bind</code>{' '}
                in Discord for quick setup, or manage bindings here.
            </p>
            {bindings.isLoading ? (
                <div className="animate-pulse space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-overlay rounded-lg" />)}</div>
            ) : bindings.isError ? (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                    <p className="text-sm text-red-400">Failed to load bindings: {bindings.error?.message}</p>
                </div>
            ) : (
                <ChannelBindingList bindings={bindings.data?.data ?? []} onUpdate={handlers.handleUpdate} onDelete={handlers.handleDelete}
                    isUpdating={handlers.isUpdating} isDeleting={handlers.isDeleting} updateError={handlers.updateError} />
            )}
            <div className="mt-4">
                <BindingCreateForm channels={channels} onCreate={handlers.handleCreate} isCreating={handlers.isCreating} createError={handlers.createError} />
            </div>
        </div>
    );
}
