import { Link } from 'react-router-dom';
import { UserLink } from '../common/UserLink';
import { formatDuration } from '../../utils/game-utils';
import { useTimezoneStore } from '../../stores/timezone-store';
import './EventBanner.css';

interface EventBannerProps {
    title: string;
    game: {
        id?: number;
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
    description?: string | null;
    isCollapsed?: boolean;
}

/**
 * Full-width horizontal banner for event details (ROK-184 AC-1).
 * Supports two modes:
 *   - Full banner: cinematic header with game art, title, meta, and optional description
 *   - Collapsed banner: slim sticky bar with condensed info (ROK-192)
 */
export function EventBanner({
    title,
    game,
    startTime,
    endTime,
    creator,
    description,
    isCollapsed = false,
}: EventBannerProps) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    // Format date/time compactly in user's preferred timezone
    const dateStr = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: resolved,
    }).format(startDate);

    const timeStr = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: resolved,
    }).format(startDate);

    // Calculate duration using shared utility
    const duration = formatDuration(startDate, endDate);

    if (isCollapsed) {
        return (
            <div className="event-banner event-banner--collapsed" role="banner">
                {/* Game icon */}
                {game && (
                    <span className="event-banner--collapsed__game" aria-label={game.name}>
                        🎮
                    </span>
                )}

                {/* Title (truncated) */}
                <span className="event-banner--collapsed__title">{title}</span>

                {/* Date (tablet+) */}
                <span className="event-banner--collapsed__date">
                    📅 {dateStr}
                </span>

                {/* Time + Creator (desktop only) */}
                <span className="event-banner--collapsed__time">
                    ⏱️ {timeStr} ({duration})
                </span>
                <span className="event-banner--collapsed__creator">
                    👤 <UserLink
                        userId={creator.id}
                        username={creator.username}
                        avatarUrl={creator.avatar}
                        showAvatar
                        size="sm"
                    />
                </span>
            </div>
        );
    }

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
                    game.id && game.id > 0 ? (
                        <Link to={`/games/${game.id}`} className="event-banner__game event-banner__game--link">
                            <span role="img" aria-hidden="true">🎮</span> {game.name}
                        </Link>
                    ) : (
                        <span className="event-banner__game">
                            <span role="img" aria-hidden="true">🎮</span> {game.name}
                        </span>
                    )
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

                {/* AC-4: Inline description (ROK-192) */}
                {description && (
                    <p className="event-banner__description">{description}</p>
                )}
            </div>
        </div>
    );
}
