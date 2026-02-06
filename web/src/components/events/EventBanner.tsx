import { UserLink } from '../common/UserLink';
import { formatDuration } from '../../utils/game-utils';
import './EventBanner.css';

interface EventBannerProps {
    title: string;
    game: {
        name: string;
        coverUrl?: string | null;
    } | null;
    startTime: string;
    endTime: string;
    creator: {
        id: number;
        username: string;
        avatar?: string | null;
    };
}

/**
 * Full-width horizontal banner for event details (ROK-184 AC-1).
 * Replaces the sidebar event card with a compact, informative header.
 */
export function EventBanner({ title, game, startTime, endTime, creator }: EventBannerProps) {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    // Format date/time compactly
    const dateStr = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(startDate);

    const timeStr = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(startDate);

    // Calculate duration using shared utility
    const duration = formatDuration(startDate, endDate);

    return (
        <div className="event-banner">
            {/* Game cover background (subtle) */}
            {game?.coverUrl && (
                <div
                    className="event-banner__bg"
                    style={{ backgroundImage: `url(${game.coverUrl})` }}
                />
            )}

            <div className="event-banner__content">
                {/* Game Badge */}
                {game && (
                    <span className="event-banner__game">
                        <span role="img" aria-hidden="true">🎮</span> {game.name}
                    </span>
                )}

                {/* Title */}
                <h1 className="event-banner__title">{title}</h1>

                <div className="event-banner__meta">
                    <span className="event-banner__date">
                        <span role="img" aria-hidden="true">📅</span> {dateStr} @ {timeStr}
                    </span>
                    <span className="event-banner__separator">•</span>
                    <span className="event-banner__duration">
                        <span role="img" aria-hidden="true">⏱️</span> {duration}
                    </span>
                    <span className="event-banner__separator">•</span>
                    <span className="event-banner__creator">
                        <span role="img" aria-hidden="true">👤</span> <UserLink
                            userId={creator.id}
                            username={creator.username}
                            avatarUrl={creator.avatar}
                            showAvatar
                            size="sm"
                        />
                    </span>
                </div>
            </div>
        </div>
    );
}
