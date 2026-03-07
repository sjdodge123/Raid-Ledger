import { memo } from 'react';
import { Link } from 'react-router-dom';
import { UserLink } from '../common/UserLink';
import { toAvatarUser } from '../../lib/avatar';
import { formatDuration } from '../../utils/game-utils';
import { useTimezoneStore } from '../../stores/timezone-store';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
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
        discordId?: string | null;
        customAvatarUrl?: string | null;
    };
    description?: string | null;
    voiceChannelName?: string | null;
    voiceChannelUrl?: string | null;
    isCollapsed?: boolean;
}

function useFormattedTimes(startTime: string, endTime: string) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    const dateStr = new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: resolved,
    }).format(startDate);

    const timeStr = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: resolved,
    }).format(startDate);

    const duration = formatDuration(startDate, endDate);
    return { dateStr, timeStr, duration };
}

function CreatorLink({ creator }: { creator: EventBannerProps['creator'] }) {
    return (
        <UserLink userId={creator.id} username={creator.username}
            user={toAvatarUser({ ...creator, avatar: creator.avatar ?? null })} showAvatar size="sm" />
    );
}

function CollapsedBanner({ title, game, dateStr, timeStr, duration, creator, isHeaderHidden }: {
    title: string; game: EventBannerProps['game']; dateStr: string; timeStr: string; duration: string;
    creator: EventBannerProps['creator']; isHeaderHidden: boolean;
}) {
    return (
        <div className={`event-banner event-banner--collapsed${isHeaderHidden ? ' event-banner--collapsed--header-hidden' : ''}`} role="banner">
            {game && <span className="event-banner--collapsed__game" aria-label={game.name}>🎮</span>}
            <span className="event-banner--collapsed__title">{title}</span>
            <span className="event-banner--collapsed__date">📅 {dateStr}</span>
            <span className="event-banner--collapsed__time">⏱️ {timeStr} ({duration})</span>
            <span className="event-banner--collapsed__creator"><CreatorLink creator={creator} /></span>
        </div>
    );
}

function GameBadge({ game }: { game: NonNullable<EventBannerProps['game']> }) {
    if (game.id && game.id > 0) {
        return (
            <Link to={`/games/${game.id}`} className="event-banner__game event-banner__game--link">
                <span role="img" aria-hidden="true">🎮</span> {game.name}
            </Link>
        );
    }
    return (
        <span className="event-banner__game">
            <span role="img" aria-hidden="true">🎮</span> {game.name}
        </span>
    );
}

function VoiceChannel({ name, url }: { name: string; url?: string | null }) {
    return (
        <>
            <span className="event-banner__separator">•</span>
            <span className="event-banner__voice-channel">
                <span role="img" aria-hidden="true">🔊</span>{' '}
                {url ? <a href={url} target="_blank" rel="noopener noreferrer">{name}</a> : name}
            </span>
        </>
    );
}

function FullBanner({ title, game, dateStr, timeStr, duration, creator, description, voiceChannelName, voiceChannelUrl }: {
    title: string; game: EventBannerProps['game']; dateStr: string; timeStr: string; duration: string;
    creator: EventBannerProps['creator']; description?: string | null;
    voiceChannelName?: string | null; voiceChannelUrl?: string | null;
}) {
    return (
        <div className="event-banner">
            {game?.coverUrl && <div className="event-banner__bg" style={{ backgroundImage: `url(${game.coverUrl})` }} />}
            <div className="event-banner__content">
                {game && <GameBadge game={game} />}
                <h1 className="event-banner__title">{title}</h1>
                <div className="event-banner__meta">
                    <span className="event-banner__date"><span role="img" aria-hidden="true">📅</span> {dateStr} @ {timeStr}</span>
                    <span className="event-banner__separator">•</span>
                    <span className="event-banner__duration"><span role="img" aria-hidden="true">⏱️</span> {duration}</span>
                    {voiceChannelName && <VoiceChannel name={voiceChannelName} url={voiceChannelUrl} />}
                    <span className="event-banner__separator">•</span>
                    <span className="event-banner__creator"><CreatorLink creator={creator} /></span>
                </div>
                {description && <p className="event-banner__description">{description}</p>}
            </div>
        </div>
    );
}

/**
 * Full-width horizontal banner for event details (ROK-184 AC-1).
 * Supports two modes:
 *   - Full banner: cinematic header with game art, title, meta, and optional description
 *   - Collapsed banner: slim sticky bar with condensed info (ROK-192)
 */
export const EventBanner = memo(function EventBanner({
    title, game, startTime, endTime, creator, description,
    voiceChannelName, voiceChannelUrl, isCollapsed = false,
}: EventBannerProps) {
    const { dateStr, timeStr, duration } = useFormattedTimes(startTime, endTime);
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    if (isCollapsed) {
        return <CollapsedBanner title={title} game={game} dateStr={dateStr} timeStr={timeStr}
            duration={duration} creator={creator} isHeaderHidden={isHeaderHidden} />;
    }

    return <FullBanner title={title} game={game} dateStr={dateStr} timeStr={timeStr}
        duration={duration} creator={creator} description={description}
        voiceChannelName={voiceChannelName} voiceChannelUrl={voiceChannelUrl} />;
});
