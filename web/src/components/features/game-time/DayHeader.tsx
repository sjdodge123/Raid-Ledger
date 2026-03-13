import type { JSX } from 'react';
import { DAYS, FULL_DAYS } from './game-time-grid.utils';

interface DayHeaderProps {
    dayIndex: number;
    fullDayNames?: boolean;
    todayIndex?: number;
    hasRolling: boolean;
    dateLabel?: string;
    nextDateLabel?: string;
    noStickyOffset?: boolean;
    isHeaderHidden: boolean;
    /** Click handler for whole-day toggle (undefined = non-interactive) */
    onClick?: () => void;
    /** Whether all 24 hours are active for this day (drives aria-pressed) */
    isAllActive?: boolean;
}

/** Single day column header for the game-time grid */
export function DayHeader({
    dayIndex, fullDayNames, todayIndex, hasRolling,
    dateLabel, nextDateLabel, noStickyOffset, isHeaderHidden, onClick, isAllActive,
}: DayHeaderProps): JSX.Element {
    const displayDay = fullDayNames ? FULL_DAYS[dayIndex] : DAYS[dayIndex];
    const isToday = todayIndex === dayIndex;
    const isTodaySplit = isToday && hasRolling;
    const isRollingPast = todayIndex !== undefined && hasRolling && dayIndex < todayIndex;
    const colorClass = getDayColorClass(isTodaySplit, isToday, isRollingPast);
    const splitBg = isTodaySplit ? { background: 'linear-gradient(to right, var(--gt-split-bg) 50%, rgba(16, 185, 129, 0.15) 50%)' } : {};
    const interactiveClass = onClick ? 'cursor-pointer hover:brightness-125' : '';

    return (
        <div
            className={`sticky ${noStickyOffset ? 'top-0' : isHeaderHidden ? 'top-0' : 'top-16'} z-10 text-center text-xs font-medium py-1 ${colorClass} ${interactiveClass}`}
            style={{ transition: 'top 300ms ease-in-out', ...splitBg }}
            data-testid={`day-header-${dayIndex}`}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            aria-pressed={onClick ? isAllActive : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
        >
            <DayLabel displayDay={displayDay} isRollingPast={isRollingPast} isTodaySplit={isTodaySplit} dateLabel={dateLabel} nextDateLabel={nextDateLabel} />
        </div>
    );
}

function getDayColorClass(isTodaySplit: boolean, isToday: boolean, isRollingPast: boolean): string {
    if (isTodaySplit) return 'text-secondary';
    if (isToday) return 'bg-emerald-500/15 text-emerald-300';
    if (isRollingPast) return 'bg-panel/80 text-dim';
    return 'bg-surface text-muted';
}

function DayWithDate({ day, sub }: { day: string; sub: JSX.Element }): JSX.Element {
    return (
        <span className="flex flex-col items-center leading-none gap-0.5">
            <span>{day}</span>{sub}
        </span>
    );
}

function DayLabel({ displayDay, isRollingPast, isTodaySplit, dateLabel, nextDateLabel }: {
    displayDay: string; isRollingPast: boolean; isTodaySplit: boolean;
    dateLabel?: string; nextDateLabel?: string;
}): JSX.Element {
    if (isRollingPast && nextDateLabel) {
        return <DayWithDate day={displayDay} sub={<span className="text-[9px] opacity-60 leading-none">{nextDateLabel}</span>} />;
    }
    if (isTodaySplit && dateLabel && nextDateLabel) {
        return (
            <DayWithDate day={displayDay} sub={
                <span className="text-[9px] leading-none flex items-center gap-0.5">
                    <span className="text-muted">{nextDateLabel}</span>
                    <span className="text-dim">/</span>
                    <span className="text-emerald-400/80">{dateLabel}</span>
                </span>
            } />
        );
    }
    if (dateLabel) {
        return <DayWithDate day={displayDay} sub={<span className="text-[9px] opacity-60 leading-none">{dateLabel}</span>} />;
    }
    return <>{displayDay}</>;
}
