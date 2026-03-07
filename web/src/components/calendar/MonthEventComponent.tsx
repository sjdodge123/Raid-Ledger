import { useCallback } from 'react';
import { format } from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import type { CalendarEvent } from './CalendarView';

interface MonthEventComponentProps {
    event: CalendarEvent;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
    onChipClick: (e: React.MouseEvent, eventStart: Date) => void;
}

function chipStyle(coverUrl: string | null | undefined, bgColor: string) {
    if (!coverUrl) return {};
    return {
        backgroundImage: `linear-gradient(135deg, ${bgColor}dd 50%, ${bgColor}88 100%), url(${coverUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center right',
    };
}

function chipTitle(event: CalendarEvent) {
    const gameName = event.resource?.game?.name;
    return `${event.title}${gameName ? ` (${gameName})` : ''}`;
}

export function MonthEventComponent({ event, eventOverlapsGameTime, onChipClick }: MonthEventComponentProps) {
    const colors = getGameColors(event.resource?.game?.slug || 'default');
    const overlaps = eventOverlapsGameTime(event.start, event.end);
    const handleClick = useCallback((e: React.MouseEvent) => onChipClick(e, event.start), [onChipClick, event.start]);

    return (
        <div className="calendar-event-chip" title={chipTitle(event)} onClick={handleClick} style={chipStyle(event.resource?.game?.coverUrl, colors.bg)}>
            {overlaps && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mr-0.5" style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }} title="Overlaps with your game time" />
            )}
            <span className="event-chip-time">{format(event.start, 'ha').toLowerCase()}</span>
            <span className="event-chip-title">{event.title}</span>
        </div>
    );
}
