import type { JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { FULL_DAYS } from '../game-time-grid.utils';
import {
    bandKind, bandShares, dayStripLabel, freeHourCount, STRIP_BANDS, type BandKind, type StripBand,
} from './phone-week.utils';

interface WeekStripProps {
    slots: GameTimeSlot[];
    /** Hours the editor is showing — the day's free-hour count, for the label. */
    hours: number[];
    /** Day being edited, grid convention (0 = Sunday). */
    day: number;
    onPick: (dayOfWeek: number) => void;
}

/**
 * Week-at-a-glance strip (ROK-1569) — seven columns, three band bars each,
 * and the day picker.
 *
 * It is a picker as well as a picture: the whole point of showing one day at a
 * time is that the other six stay legible, so each column is a real button
 * that jumps the editor rather than a decoration beside one.
 *
 * ROK-1579 (operator ruling 2026-09-16) condensed it: one bar per visible hour
 * was 16–17 bars tall on the profile's fitted window. Now it is day / evening /
 * late, each filled by the share of that band the viewer has claimed.
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
                    kinds={bandShares(slots, d).map(bandKind)}
                    onPick={onPick}
                />
            ))}
        </div>
    );
}

/** One day's column: its three band bars and its letter. */
function StripColumn({ dayOfWeek, active, freeHours, kinds, onPick }: {
    dayOfWeek: number; active: boolean; freeHours: number; kinds: BandKind[];
    onPick: (dayOfWeek: number) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={dayStripLabel(dayOfWeek, freeHours)}
            aria-current={active ? 'date' : undefined}
            onClick={() => onPick(dayOfWeek)}
            data-testid={`phone-week-strip-day-${dayOfWeek}`}
            className={`flex flex-col gap-0.5 rounded-md border p-1 ${
                active ? 'border-emerald-500 bg-emerald-500/10' : 'border-edge bg-panel'
            }`}
        >
            {STRIP_BANDS.map((band, i) => <BandBar key={band.id} band={band} kind={kinds[i]} />)}
            <span className={`pt-0.5 text-center text-[10px] ${active ? 'text-foreground' : 'text-dim'}`}>
                {FULL_DAYS[dayOfWeek][0]}
            </span>
        </button>
    );
}

/** Fill for a band's bar — solid when it is all claimed, half-tone when some is. */
const BAND_FILL: Record<BandKind, string> = {
    full: 'bg-emerald-500',
    partial: 'bg-emerald-500/50',
    none: 'bg-edge',
};

/**
 * One band of one day: all of it, some of it, or none of it.
 *
 * Flat fills only — ROK-1569's diagonal hatch for a stale week was ruled out on
 * 2026-09-16 (ROK-1579), so an unclaimed band reads the same however old the
 * viewer's saved week is.
 */
function BandBar({ band, kind }: { band: StripBand; kind: BandKind }): JSX.Element {
    return (
        <i
            data-testid="phone-week-strip-bar"
            data-band={band.id}
            data-kind={kind}
            className={`block h-[5px] rounded-[1px] ${BAND_FILL[kind]}`}
        />
    );
}
