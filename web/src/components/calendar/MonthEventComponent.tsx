import { useCallback } from 'react';
import { format } from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import type { CalendarEvent } from './CalendarView';

interface MonthEventComponentProps {
    event: CalendarEvent;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
    onChipClick: (e: React.MouseEvent, eventStart: Date) => void;
}

export function MonthEventComponent({ event, eventOverlapsGameTime, onChipClick }: MonthEventComponentProps) {
    const gameSlug = event.resource?.game?.slug || 'default';
    const coverUrl = event.resource?.game?.coverUrl;
    const colors = getGameColors(gameSlug);
    const overlaps = eventOverlapsGameTime(event.start, event.end);
    const timeStr = format(event.start, 'ha').toLowerCase();

    const handleClick = useCallback(
        (e: React.MouseEvent) => onChipClick(e, event.start),
        [onChipClick, event.start],
    );

    return (
        <div
            className="calendar-event-chip"
            title={`${event.title}${event.resource?.game?.name ? ` (${event.resource.game.name})` : ''}`}
            onClick={handleClick}
            style={{
                backgroundImage: coverUrl
                    ? `linear-gradient(135deg, ${colors.bg}dd 50%, ${colors.bg}88 100%), url(${coverUrl})`
                    : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center right',
            }}
        >
            {overlaps && (
                <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mr-0.5"
                    style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }}
                    title="Overlaps with your game time"
                />
            )}
            <span className="event-chip-time">{timeStr}</span>
            <span className="event-chip-title">{event.title}</span>
        </div>
    );
}
