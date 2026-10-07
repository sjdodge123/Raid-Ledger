import type { JSX } from 'react';
import { DAYS, FULL_DAYS } from './game-time-grid.utils';

interface DayHeaderProps {
    dayIndex: number;
    fullDayNames?: boolean | undefined;
    todayIndex?: number | undefined;
    dateLabel?: string | undefined;
    noStickyOffset?: boolean | undefined;
    isHeaderHidden: boolean;
    /** Click handler for whole-day toggle (undefined = non-interactive) */
    onClick?: (() => void) | undefined;
    /** Whether all 24 hours are active for this day (drives aria-pressed) */
    isAllActive?: boolean | undefined;
    /** The viewer is away this day (ROK-1585): "Sat · away", muted. */
    isAway?: boolean | undefined;
}

/** Single day column header for the game-time grid */
export function DayHeader({
    dayIndex, fullDayNames, todayIndex,
    dateLabel, noStickyOffset, isHeaderHidden, onClick, isAllActive, isAway,
}: DayHeaderProps): JSX.Element {
    // An away day always takes the SHORT name ("Sat · away", ROK-1585 artboard).
    const dayName = (fullDayNames && !isAway ? FULL_DAYS[dayIndex] : DAYS[dayIndex]) ?? '';
    const displayDay = isAway ? `${dayName} · away` : dayName;
    const isToday = todayIndex === dayIndex;
    const colorClass = isAway && !isToday ? 'bg-overlay/40 text-muted' : getDayColorClass(isToday);
    const interactiveClass = onClick ? 'cursor-pointer hover:brightness-125' : '';

    return (
        <div
            className={`sticky ${noStickyOffset ? 'top-0' : isHeaderHidden ? 'top-0' : 'top-16'} z-10 text-center text-sm font-medium py-1 ${colorClass} ${interactiveClass}`}
            style={{ transition: 'top 300ms ease-in-out' }}
            data-testid={`day-header-${dayIndex}`}
            data-away={isAway ? 'true' : undefined}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            aria-pressed={onClick ? isAllActive : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
        >
            <DayLabel displayDay={displayDay} dateLabel={dateLabel} />
        </div>
    );
}

function getDayColorClass(isToday: boolean): string {
    if (isToday) return 'bg-emerald-500/15 text-emerald-300';
    return 'bg-surface text-muted';
}

function DayWithDate({ day, sub }: { day: string; sub: JSX.Element }): JSX.Element {
    return (
        <span className="flex flex-col items-center leading-none gap-0.5">
            <span>{day}</span>{sub}
        </span>
    );
}

function DayLabel({ displayDay, dateLabel }: { displayDay: string; dateLabel?: string | undefined }): JSX.Element {
    if (dateLabel) {
        return <DayWithDate day={displayDay} sub={<span className="text-xs opacity-80 leading-none">{dateLabel}</span>} />;
    }
    return <>{displayDay}</>;
}
