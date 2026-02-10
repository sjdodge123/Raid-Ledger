import { useNavigate } from 'react-router-dom';
import { useNotifications, type Notification } from '../../hooks/use-notifications';

interface NotificationItemProps {
    notification: Notification;
    onClose: () => void;
}

/**
 * Individual notification row.
 * Shows icon, title, time ago, and read/unread state.
 * Clicking navigates to relevant page and marks as read.
 */
export function NotificationItem({
    notification,
    onClose,
}: NotificationItemProps) {
    const navigate = useNavigate();
    const { markRead } = useNotifications();

    const isUnread = !notification.readAt;

    const handleClick = () => {
        // Mark as read
        if (isUnread) {
            markRead(notification.id);
        }

        // Navigate to relevant page if payload has a link
        if (notification.payload?.eventId) {
            navigate(`/events/${notification.payload.eventId}`);
            onClose();
        } else if (notification.payload?.link) {
            navigate(notification.payload.link);
            onClose();
        }
    };

    // Get icon based on notification type
    const getIcon = () => {
        switch (notification.type) {
            case 'slot_vacated':
                return (
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                        />
                    </svg>
                );
            case 'event_reminder':
                return (
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                );
            case 'new_event':
                return (
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                );
            case 'subscribed_game':
                return (
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
                        />
                    </svg>
                );
            default:
                return (
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                );
        }
    };

    // Format time ago
    const getTimeAgo = () => {
        const now = new Date();
        const created = new Date(notification.createdAt);
        const diffMs = now.getTime() - created.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return created.toLocaleDateString();
    };

    return (
        <button
            onClick={handleClick}
            className={`w-full px-4 py-3 text-left hover:bg-panel/50 transition-colors ${isUnread ? 'bg-panel/30' : ''
                }`}
        >
            <div className="flex items-start gap-3">
                {/* Icon */}
                <div
                    className={`flex-shrink-0 p-2 rounded-full ${isUnread
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-overlay/50 text-muted'
                        }`}
                >
                    {getIcon()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <p
                        className={`text-sm font-medium ${isUnread ? 'text-foreground' : 'text-secondary'
                            }`}
                    >
                        {notification.title}
                    </p>
                    <p className="text-sm text-muted mt-0.5 line-clamp-2">
                        {notification.message}
                    </p>
                    <p className="text-xs text-dim mt-1">{getTimeAgo()}</p>
                </div>

                {/* Unread indicator */}
                {isUnread && (
                    <div className="flex-shrink-0 w-2 h-2 bg-emerald-400 rounded-full mt-2" />
                )}
            </div>
        </button>
    );
}
