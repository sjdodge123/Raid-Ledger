import type { JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { FULL_DAYS } from '../game-time-grid.utils';
import { dayStripLabel, freeHourCount, hourBarKinds, type HourBarKind } from './phone-week.utils';

/**
 * Diagonal hatch for an hour nobody has confirmed. The colour comes from the
 * `currentColor`, so the `text-amber-400` class on the same element carries the
 * colour — and the light family's `-400 → -600` text override reaches the hatch
 * too (the token itself never changes per scheme; review MINOR 5).
 */
const HATCH = 'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 4px)';

interface WeekStripProps {
    slots: GameTimeSlot[];
    hours: number[];
    /** Day being edited, grid convention (0 = Sunday). */
    day: number;
    /** The viewer's saved week is older than the freshness window. */
    stale?: boolean;
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
export function WeekStrip({ slots, hours, day, stale = false, onPick }: WeekStripProps): JSX.Element {
    return (
        <div className="grid grid-cols-7 gap-1 pt-2" data-testid="phone-week-strip">
            {FULL_DAYS.map((name, d) => (
                <StripColumn
                    key={name}
                    dayOfWeek={d}
                    active={d === day}
                    freeHours={freeHourCount(slots, d, hours)}
                    bars={hourBarKinds(slots, d, hours, stale)}
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

/** One hour of one day, three states deep. */
function HourBar({ kind }: { kind: HourBarKind }): JSX.Element {
    const tone = kind === 'free' ? 'bg-emerald-500' : kind === 'stale' ? 'text-amber-400' : 'bg-edge';
    return (
        <i
            data-bar={kind}
            className={`block h-[5px] rounded-[1px] ${tone}`}
            style={kind === 'stale' ? { backgroundImage: HATCH } : undefined}
        />
    );
}
