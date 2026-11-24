import { useMemo } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { notificationRowCaption, type NotificationRowCaption } from './notification-row-caption';
import {
    useNotificationPreferences,
    type NotificationType,
    type Channel,
} from '../../hooks/use-notifications';
import { useNotifTypeHashFocus } from '../../hooks/use-notif-type-hash-focus';
import { ChannelIcon } from './notification-channel-icons';
import { MutedGamesList } from './muted-games-list';
import { MutedGroupsList } from './muted-groups-list';
import { NOTIFICATION_TYPE_GROUPS, rowChannels } from './notification-type-meta';

/** All possible channel metadata */
const ALL_CHANNEL_META: { channel: Channel; label: string }[] = [
    { channel: 'inApp', label: 'In-App' },
    { channel: 'push', label: 'Push' },
    { channel: 'discord', label: 'Discord' },
];

/** Skeleton placeholder while loading */
function PreferencesSkeleton() {
    return (
        <div className="space-y-4 animate-pulse">
            <div className="flex justify-end gap-6 pr-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="w-10 h-4 bg-panel rounded" />
                ))}
            </div>
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between py-3">
                    <div className="space-y-2">
                        <div className="w-32 h-4 bg-panel rounded" />
                        <div className="w-48 h-3 bg-panel rounded" />
                    </div>
                    <div className="flex gap-6">
                        {[1, 2, 3].map((j) => (
                            <div key={j} className="w-8 h-8 bg-panel rounded-full" />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Notification preferences section for the Profile Page (ROK-179, ROK-180).
 * Shows a per-type-per-channel toggle matrix with icon buttons.
 * Discord column is only shown when user has Discord linked AND bot is connected (AC-7).
 */
function ColumnHeaders({ visibleChannels }: { visibleChannels: { channel: Channel; label: string }[] }) {
    return (
        <div className="flex items-center mb-2">
            <div className="flex-1" />
            <div className="flex gap-2 sm:gap-4">
                {visibleChannels.map(({ channel, label }) => (
                    <div key={channel} className="w-10 sm:w-12 flex flex-col items-center">
                        <span className="text-[10px] sm:text-xs font-medium text-muted uppercase tracking-wider">{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ChannelToggle({ channel, active, label, onToggle }: {
    channel: Channel; active: boolean; label: string; onToggle: () => void;
}) {
    return (
        <div className="w-10 sm:w-12 flex justify-center">
            <button type="button" onClick={onToggle}
                className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all ${
                    active ? 'text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-muted hover:text-secondary hover:bg-panel'
                }`}
                aria-label={`${active ? 'Disable' : 'Enable'} ${label} ${channel} notifications`}>
                <ChannelIcon channel={channel} active={active} />
            </button>
        </div>
    );
}

/** ROK-2290: what the row's switches add up to — "Discord DM only" (success) or "Muted" (muted). */
function RowCaption({ caption }: { caption: NotificationRowCaption }) {
    if (!caption) return null;
    const tone = caption === 'Discord DM only' ? 'text-success' : 'text-muted';
    return <div className={`text-xs mt-0.5 ${tone}`} data-testid="notif-row-caption">{caption}</div>;
}

/** ROK-2311: a column this row's notice never uses (in-app-only / DM-only rows) shows a dash, not a switch. */
function ChannelNotOffered({ channel }: { channel: Channel }) {
    return (
        <div className="w-10 sm:w-12 flex justify-center text-dim" data-testid={`notif-not-offered-${channel}`}>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not sent by {channel}</span>
        </div>
    );
}

function NotificationRow({ type, label, description, visibleChannels, preferences, onToggle }: {
    type: NotificationType; label: string; description: string;
    visibleChannels: { channel: Channel; label: string }[];
    preferences: ReturnType<typeof useNotificationPreferences>['preferences'];
    onToggle: (type: NotificationType, channel: Channel) => void;
}) {
    const offered = rowChannels(type, visibleChannels).map((c) => c.channel);
    return (
        <div id={`notif-${type}`} tabIndex={-1}
            className="flex items-center py-3 hover:bg-panel/50 rounded-lg transition-colors -mx-2 px-2 focus:outline-none focus:ring-2 focus:ring-success/80">
            <div className="flex-1 min-w-0 mr-3">
                <div className="text-sm font-medium text-foreground truncate">{label}</div>
                <div className="text-xs text-muted truncate">{description}</div>
                <RowCaption caption={notificationRowCaption(preferences?.channelPrefs[type], offered)} />
            </div>
            <div className="flex gap-2 sm:gap-4 shrink-0">
                {visibleChannels.map(({ channel }) => offered.includes(channel) ? (
                    <ChannelToggle key={channel} channel={channel} active={preferences?.channelPrefs[type]?.[channel] ?? false}
                        label={label} onToggle={() => onToggle(type, channel)} />
                ) : <ChannelNotOffered key={channel} channel={channel} />)}
            </div>
        </div>
    );
}

/** Stable id for a group heading, e.g. "Games & groups" → `notif-group-games-groups`. */
function groupHeadingId(heading: string): string {
    return `notif-group-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

function NotificationPreferencesContent({ preferences, visibleChannels, handleToggle, channelAvailability }: {
    preferences: ReturnType<typeof useNotificationPreferences>['preferences'];
    visibleChannels: { channel: Channel; label: string }[];
    handleToggle: (type: NotificationType, channel: Channel) => void;
    channelAvailability: ReturnType<typeof useNotificationPreferences>['channelAvailability'];
}) {
    return (
        <div>
            <ColumnHeaders visibleChannels={visibleChannels} />
            <div className="border-t border-edge-subtle mb-1" />
            {NOTIFICATION_TYPE_GROUPS.map((group) => (
                <section key={group.heading} aria-labelledby={groupHeadingId(group.heading)} data-testid="notif-group">
                    <h3 id={groupHeadingId(group.heading)}
                        className="text-[11px] font-semibold uppercase tracking-wider text-dim pt-3.5 pb-1">
                        {group.heading}
                    </h3>
                    <div className="divide-y divide-edge-subtle border-t border-edge-subtle">
                        {group.rows.map((meta) => (
                            <div key={meta.type}>
                                <NotificationRow {...meta} visibleChannels={visibleChannels} preferences={preferences} onToggle={handleToggle} />
                                {meta.type === 'subscribed_game' && <MutedGamesList />}
                                {meta.type === 'hub_leader_post' && <MutedGroupsList />}
                            </div>
                        ))}
                    </div>
                </section>
            ))}
            {channelAvailability?.discord && !channelAvailability.discord.available && channelAvailability.discord.reason && (
                <p className="text-xs text-muted mt-4 italic">{channelAvailability.discord.reason}</p>
            )}
        </div>
    );
}

export function NotificationPreferencesSection() {
    const { preferences, isLoading, updatePreferences, channelAvailability } = useNotificationPreferences();
    const visibleChannels = useMemo(() => {
        const discordAvailable = channelAvailability?.discord?.available ?? false;
        return ALL_CHANNEL_META.filter(({ channel }) => channel !== 'discord' || discordAvailable);
    }, [channelAvailability]);
    useNotifTypeHashFocus(!isLoading && !!preferences);
    const handleToggle = (type: NotificationType, channel: Channel) => {
        if (!preferences) return;
        const current = preferences.channelPrefs[type]?.[channel] ?? true;
        updatePreferences({ channelPrefs: { [type]: { [channel]: !current } } });
    };

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Notifications</h2>
            <p className="text-sm text-muted mb-1.5">Choose how and when you get notified</p>
            <p className="text-xs text-muted mb-5 flex items-start gap-1.5" data-testid="notif-channels-hint">
                <InformationCircleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span><span className="text-secondary font-medium">The bell and Discord switches are separate</span> — turn off the bell and you still get the DM.</span>
            </p>
            {isLoading || !preferences ? <PreferencesSkeleton /> : (
                <NotificationPreferencesContent preferences={preferences} visibleChannels={visibleChannels} handleToggle={handleToggle} channelAvailability={channelAvailability} />
            )}
        </div>
    );
}
