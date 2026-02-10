import { useNotifications } from '../../hooks/use-notifications';
import { NotificationItem } from './NotificationItem';

interface NotificationDropdownProps {
    onClose: () => void;
}

/**
 * Notification dropdown panel (Facebook-style).
 * Shows scrollable list of notifications with "Mark All Read" button.
 */
export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
    const { notifications, isLoading, markAllRead } = useNotifications(20, 0);

    const handleMarkAllRead = () => {
        markAllRead();
    };

    return (
        <div className="absolute right-0 top-full mt-2 w-96 bg-surface border border-edge rounded-lg shadow-2xl overflow-hidden z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
                <h3 className="text-lg font-semibold text-foreground">Notifications</h3>
                {notifications.length > 0 && (
                    <button
                        onClick={handleMarkAllRead}
                        className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                        Mark All Read
                    </button>
                )}
            </div>

            {/* Notification List */}
            <div className="max-h-[400px] overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                        <svg
                            className="w-16 h-16 text-faint mb-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                            />
                        </svg>
                        <p className="text-muted font-medium">No notifications</p>
                        <p className="text-sm text-dim mt-1">
                            You're all caught up!
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-edge-subtle">
                        {notifications.map((notification) => (
                            <NotificationItem
                                key={notification.id}
                                notification={notification}
                                onClose={onClose}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
