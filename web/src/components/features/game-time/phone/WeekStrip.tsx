import type { JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { FULL_DAYS } from '../game-time-grid.utils';
import { dayStripLabel, freeHourCount, hourBarKinds, type HourBarKind } from './phone-week.utils';

interface WeekStripProps {
    slots: GameTimeSlot[];
    hours: number[];
    /** Day being edited, grid convention (0 = Sunday). */
    day: number;
    onPick: (dayOfWeek: number) => void;
}

/**
 * Week-at-a-glance strip (ROK-1569) — seven columns, one bar per visible hour,
 * and the day picker.
 *
 * It is a picker as well as a picture: the whole point of showing one day at a
 * time is that the other six stay legible, so each column is a real button
 * that jumps the editor rather than a decoration beside one.
 */
export function WeekStrip({ slots, hours, day, onPick }: WeekStripProps): JSX.Element {
    return (
        <div className="grid flex-none grid-cols-7 gap-1 pt-2" data-testid="phone-week-strip">
            {FULL_DAYS.map((name, d) => (
                <StripColumn
                    key={name}
                    dayOfWeek={d}
                    active={d === day}
                    freeHours={freeHourCount(slots, d, hours)}
                    bars={hourBarKinds(slots, d, hours)}
                    onPick={onPick}
                />
            ))}
        </div>
    );
}

/** One day's column: its hour bars and its letter. */
function StripColumn({ dayOfWeek, active, freeHours, bars, onPick }: {
    dayOfWeek: number; active: boolean; freeHours: number; bars: HourBarKind[];
    onPick: (dayOfWeek: number) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={dayStripLabel(dayOfWeek, freeHours)}
            aria-current={active ? 'date' : undefined}
            onClick={() => onPick(dayOfWeek)}
            data-testid={`phone-week-strip-day-${dayOfWeek}`}
            className={`flex flex-col gap-px rounded-md border p-1 ${
                active ? 'border-emerald-500 bg-emerald-500/10' : 'border-edge bg-panel'
            }`}
        >
            {bars.map((kind, i) => <HourBar key={i} kind={kind} />)}
            <span className={`pt-0.5 text-center text-[10px] ${active ? 'text-foreground' : 'text-dim'}`}>
                {FULL_DAYS[dayOfWeek][0]}
            </span>
        </button>
    );
}

/**
 * One hour of one day: free, or not.
 *
 * ROK-1569 had a third, hatched "stale" state; the operator ruled the
 * cross-hatch out on 2026-09-16 (ROK-1579), so an unclaimed hour reads the same
 * however old the viewer's saved week is.
 */
function HourBar({ kind }: { kind: HourBarKind }): JSX.Element {
    return (
        <i
            data-bar={kind}
            className={`block h-[5px] rounded-[1px] ${kind === 'free' ? 'bg-emerald-500' : 'bg-edge'}`}
        />
    );
}
