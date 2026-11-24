import { useMemo } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import {
    useNotificationPreferences,
    type NotificationType,
    type Channel,
} from '../../hooks/use-notifications';
import { useNotifTypeHashFocus } from '../../hooks/use-notif-type-hash-focus';
import { MutedGamesList } from './muted-games-list';
import { MutedGroupsList } from './muted-groups-list';
import { NOTIFICATION_TYPE_GROUPS } from './notification-type-meta';
import { NotificationGroup, type ChannelColumn } from './notification-matrix-rows';

/** All possible channel metadata */
const ALL_CHANNEL_META: ChannelColumn[] = [
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
function ColumnHeaders({ visibleChannels }: { visibleChannels: ChannelColumn[] }) {
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

/** ROK-2311: the muted-games / muted-groups lists sit under their rows. */
function afterRow(type: NotificationType) {
    if (type === 'subscribed_game') return <MutedGamesList />;
    if (type === 'hub_leader_post') return <MutedGroupsList />;
    return null;
}

function NotificationPreferencesContent({ preferences, visibleChannels, handleToggle, channelAvailability }: {
    preferences: ReturnType<typeof useNotificationPreferences>['preferences'];
    visibleChannels: ChannelColumn[];
    handleToggle: (type: NotificationType, channel: Channel) => void;
    channelAvailability: ReturnType<typeof useNotificationPreferences>['channelAvailability'];
}) {
    const prefsOf = (type: NotificationType) => preferences?.channelPrefs[type];
    return (
        <div>
            <ColumnHeaders visibleChannels={visibleChannels} />
            <div className="border-t border-edge-subtle mb-1" />
            {NOTIFICATION_TYPE_GROUPS.map((group) => (
                <NotificationGroup key={group.heading} group={group} visibleChannels={visibleChannels}
                    prefsOf={prefsOf} onToggle={handleToggle} afterRow={afterRow} />
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
