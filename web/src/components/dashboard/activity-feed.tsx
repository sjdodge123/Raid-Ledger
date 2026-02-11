import { useNotifications, type Notification } from '../../hooks/use-notifications';

/** Event-related notification types we show in the activity feed */
const EVENT_TYPES = new Set([
    'slot_vacated',
    'event_reminder',
    'new_event',
]);

function getRelativeTimeAgo(dateString: string): string {
    const diff = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function ActivityItem({ notification }: { notification: Notification }) {
    return (
        <div className="flex items-start gap-3 py-2">
            <span className="text-muted mt-0.5 text-sm shrink-0">•</span>
            <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground line-clamp-2">
                    {notification.message}
                </p>
                <p className="text-xs text-dim mt-0.5">
                    {getRelativeTimeAgo(notification.createdAt)}
                </p>
            </div>
        </div>
    );
}

export function ActivityFeed() {
    const { notifications, isLoading } = useNotifications(20);

    const eventNotifications = notifications
        .filter((n) => EVENT_TYPES.has(n.type))
        .slice(0, 10);

    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 animate-pulse">
                        <div className="w-2 h-2 bg-panel rounded-full mt-1.5" />
                        <div className="flex-1 space-y-1">
                            <div className="h-4 bg-panel rounded w-3/4" />
                            <div className="h-3 bg-panel rounded w-16" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (eventNotifications.length === 0) {
        return (
            <p className="text-sm text-muted py-4">No recent activity</p>
        );
    }

    return (
        <div className="divide-y divide-edge-subtle">
            {eventNotifications.map((n) => (
                <ActivityItem key={n.id} notification={n} />
            ))}
        </div>
    );
}
