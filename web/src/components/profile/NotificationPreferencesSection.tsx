import { useMemo } from 'react';
import {
    useNotificationPreferences,
    type NotificationType,
    type Channel,
} from '../../hooks/use-notifications';
import { useNotifTypeHashFocus } from '../../hooks/use-notif-type-hash-focus';
import { ChannelIcon } from './notification-channel-icons';
import { MutedGamesList } from './muted-games-list';
import { MutedGroupsList } from './muted-groups-list';

/** Metadata for each notification type row */
const NOTIFICATION_TYPE_META: {
    type: NotificationType;
    label: string;
    description: string;
}[] = [
    {
        type: 'slot_vacated',
        label: 'Slot Vacated',
        description: 'When someone leaves a roster slot',
    },
    {
        type: 'member_returned',
        label: 'Member Returned',
        description: 'When a departed member rejoins a live event',
    },
    {
        type: 'event_reminder',
        label: 'Event Reminders',
        description: 'Reminders for upcoming events',
    },
    {
        type: 'new_event',
        label: 'New Events',
        description: 'When new events are created',
    },
    {
        type: 'subscribed_game',
        label: 'Subscribed Games',
        description: 'Activity for games you follow',
    },
    {
        type: 'hub_leader_post',
        label: 'Group posts',
        description: 'A leader posts an update in a group you belong to',
    },
    {
        type: 'hub_event_tagged',
        label: 'Group events',
        description: 'An event is tagged to a group you belong to',
    },
    {
        type: 'hub_proposal_submitted',
        label: 'Hub proposals',
        description: 'Someone proposes a new community hub for review (staff)',
    },
    {
        type: 'hub_proposal_reviewed',
        label: 'Hub proposal decisions',
        description: 'Your community hub proposal is approved or rejected',
    },
    {
        type: 'event_cancelled',
        label: 'Event Cancelled',
        description: 'When an event you signed up for is cancelled',
    },
    {
        type: 'event_rescheduled',
        label: 'Event Rescheduled',
        description: 'When an event you signed up for is rescheduled',
    },
    {
        type: 'bench_promoted',
        label: 'Bench Promoted',
        description: 'When you are moved from bench to the active roster',
    },
    {
        type: 'roster_reassigned',
        label: 'Roster Reassignment',
        description: 'When your roster slot or role is changed',
    },
    {
        type: 'tentative_displaced',
        label: 'Tentative Displaced',
        description: 'When a confirmed player takes your tentative slot',
    },
    {
        type: 'community_lineup',
        label: 'Community Lineup',
        description: 'Updates about community lineup voting, matches, and scheduling',
    },
    {
        type: 'post_event_followup',
        label: 'Post-Event Follow-Ups',
        description: 'Prompts to schedule a follow-up and quick sign-up invites after an event ends',
    },
    {
        type: 'lfg_invite',
        label: 'LFG group forming',
        description: 'A group is forming for a game you subscribe to',
    },
    {
        type: 'lfg_player_invite',
        label: 'LFG player invites',
        description: 'A player invites you to join their group for a game',
    },
];

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

function NotificationRow({ type, label, description, visibleChannels, preferences, onToggle }: {
    type: NotificationType; label: string; description: string;
    visibleChannels: { channel: Channel; label: string }[];
    preferences: ReturnType<typeof useNotificationPreferences>['preferences'];
    onToggle: (type: NotificationType, channel: Channel) => void;
}) {
    return (
        <div id={`notif-${type}`} tabIndex={-1}
            className="flex items-center py-3 hover:bg-panel/50 rounded-lg transition-colors -mx-2 px-2 focus:outline-none focus:ring-2 focus:ring-success/80">
            <div className="flex-1 min-w-0 mr-3">
                <div className="text-sm font-medium text-foreground truncate">{label}</div>
                <div className="text-xs text-muted truncate">{description}</div>
            </div>
            <div className="flex gap-2 sm:gap-4 shrink-0">
                {visibleChannels.map(({ channel }) => (
                    <ChannelToggle key={channel} channel={channel} active={preferences?.channelPrefs[type]?.[channel] ?? false}
                        label={label} onToggle={() => onToggle(type, channel)} />
                ))}
            </div>
        </div>
    );
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
            <div className="divide-y divide-edge-subtle">
                {NOTIFICATION_TYPE_META.map((meta) => (
                    <div key={meta.type}>
                        <NotificationRow {...meta} visibleChannels={visibleChannels} preferences={preferences} onToggle={handleToggle} />
                        {meta.type === 'subscribed_game' && <MutedGamesList />}
                        {meta.type === 'hub_leader_post' && <MutedGroupsList />}
                    </div>
                ))}
            </div>
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
            <p className="text-sm text-muted mb-5">Choose how and when you get notified</p>
            {isLoading || !preferences ? <PreferencesSkeleton /> : (
                <NotificationPreferencesContent preferences={preferences} visibleChannels={visibleChannels} handleToggle={handleToggle} channelAvailability={channelAvailability} />
            )}
        </div>
    );
}
