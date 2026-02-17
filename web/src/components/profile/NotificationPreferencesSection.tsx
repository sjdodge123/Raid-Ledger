import {
    useNotificationPreferences,
    type NotificationType,
    type Channel,
} from '../../hooks/use-notifications';

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
        type: 'achievement_unlocked',
        label: 'Achievements',
        description: 'When you earn an achievement',
    },
    {
        type: 'level_up',
        label: 'Level Up',
        description: 'When you reach a new level',
    },
    {
        type: 'missed_event_nudge',
        label: 'Missed Event Nudge',
        description: 'Suggestions to update your game time',
    },
];

/** Channel metadata for column headers */
const CHANNEL_META: { channel: Channel; label: string }[] = [
    { channel: 'inApp', label: 'In-App' },
    { channel: 'push', label: 'Push' },
    { channel: 'discord', label: 'Discord' },
];

/** Bell icon (in-app) */
function BellIcon({ active }: { active: boolean }) {
    return (
        <svg
            className={`w-5 h-5 ${active ? 'fill-current' : 'fill-none stroke-current'}`}
            viewBox="0 0 24 24"
            strokeWidth={active ? 0 : 2}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
        </svg>
    );
}

/** Globe icon (push/browser) */
function GlobeIcon({ active }: { active: boolean }) {
    return (
        <svg
            className={`w-5 h-5 ${active ? 'fill-current' : 'fill-none stroke-current'}`}
            viewBox="0 0 24 24"
            strokeWidth={active ? 0 : 2}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9 9 0 100-18 9 9 0 000 18z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z"
            />
        </svg>
    );
}

/** Discord icon */
function DiscordIcon({ active }: { active: boolean }) {
    return (
        <svg
            className={`w-5 h-5 ${active ? 'opacity-100' : 'opacity-60'}`}
            fill="currentColor"
            viewBox="0 0 24 24"
        >
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    );
}

/** Render the correct icon for a channel */
function ChannelIcon({ channel, active }: { channel: Channel; active: boolean }) {
    switch (channel) {
        case 'inApp':
            return <BellIcon active={active} />;
        case 'push':
            return <GlobeIcon active={active} />;
        case 'discord':
            return <DiscordIcon active={active} />;
    }
}

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
 * Notification preferences section for the Profile Page (ROK-179).
 * Shows a per-type-per-channel toggle matrix with icon buttons.
 */
export function NotificationPreferencesSection() {
    const { preferences, isLoading, updatePreferences } =
        useNotificationPreferences();

    function handleToggle(type: NotificationType, channel: Channel) {
        if (!preferences) return;
        const current = preferences.channelPrefs[type]?.[channel] ?? true;
        updatePreferences({
            channelPrefs: { [type]: { [channel]: !current } },
        });
    }

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">
                Notifications
            </h2>
            <p className="text-sm text-muted mb-5">
                Choose how and when you get notified
            </p>

            {isLoading || !preferences ? (
                <PreferencesSkeleton />
            ) : (
                <div>
                    {/* Column headers */}
                    <div className="flex items-center mb-2">
                        <div className="flex-1" />
                        <div className="flex gap-2 sm:gap-4">
                            {CHANNEL_META.map(({ channel, label }) => (
                                <div
                                    key={channel}
                                    className="w-10 sm:w-12 flex flex-col items-center"
                                >
                                    <span className="text-[10px] sm:text-xs font-medium text-muted uppercase tracking-wider">
                                        {label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-edge-subtle mb-1" />

                    {/* Notification type rows */}
                    <div className="divide-y divide-edge-subtle">
                        {NOTIFICATION_TYPE_META.map(({ type, label, description }) => (
                            <div
                                key={type}
                                className="flex items-center py-3 hover:bg-panel/50 rounded-lg transition-colors -mx-2 px-2"
                            >
                                {/* Label + description */}
                                <div className="flex-1 min-w-0 mr-3">
                                    <div className="text-sm font-medium text-foreground truncate">
                                        {label}
                                    </div>
                                    <div className="text-xs text-muted truncate">
                                        {description}
                                    </div>
                                </div>

                                {/* Channel toggles */}
                                <div className="flex gap-2 sm:gap-4 shrink-0">
                                    {CHANNEL_META.map(({ channel }) => {
                                        const active =
                                            preferences.channelPrefs[type]?.[channel] ?? false;
                                        return (
                                            <div
                                                key={channel}
                                                className="w-10 sm:w-12 flex justify-center"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggle(type, channel)}
                                                    className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all ${
                                                        active
                                                            ? 'text-emerald-400 bg-emerald-500/15 hover:bg-emerald-500/25'
                                                            : 'text-muted hover:text-secondary hover:bg-panel'
                                                    }`}
                                                    aria-label={`${active ? 'Disable' : 'Enable'} ${label} ${channel} notifications`}
                                                >
                                                    <ChannelIcon
                                                        channel={channel}
                                                        active={active}
                                                    />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
