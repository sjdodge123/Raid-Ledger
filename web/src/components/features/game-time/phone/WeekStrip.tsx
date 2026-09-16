import type { CSSProperties, JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { FULL_DAYS } from '../game-time-grid.utils';
import {
    bandKind, bandShares, dayStripLabel, freeHourCount, STRIP_BANDS, type BandKind, type StripBand,
} from './phone-week.utils';
import {
    groupBandKind, groupStripLabel, type GroupBandKind, type GroupBandShare,
} from './group-day.utils';

/** What a bar can represent: the viewer's own week, or the group's (ROK-1580). */
type StripKind = BandKind | GroupBandKind;

/**
 * One bar, resolved: its fill, the second tone it splits into when the band's
 * hours disagree, and whether it wears the busy cap (ROK-1584).
 */
interface BarSpec {
    kind: StripKind;
    otherKind: GroupBandKind | null;
    busy: boolean;
}

/** The viewer's own week has one tone per band and never a cap. */
function viewerBars(slots: GameTimeSlot[], dayOfWeek: number): BarSpec[] {
    return bandShares(slots, dayOfWeek)
        .map(bandKind)
        .map((kind) => ({ kind, otherKind: null, busy: false }));
}

/** The group's bars: two tones when the band disagrees, capped when someone is busy. */
function groupBars(bands: GroupBandShare[]): BarSpec[] {
    return bands.map((band) => ({
        kind: groupBandKind(band.best),
        otherKind: band.other === null ? null : groupBandKind(band.other),
        busy: band.busy,
    }));
}

interface WeekStripProps {
    slots: GameTimeSlot[];
    /** Hours the editor is showing — the day's free-hour count, for the label. */
    hours: number[];
    /** Day being edited, grid convention (0 = Sunday). */
    day: number;
    onPick: (dayOfWeek: number) => void;
    /**
     * GROUP mode (ROK-1580): seven days × three bands of how free EVERYONE is,
     * from `groupBandShares`. When given, it replaces the viewer-derived bars
     * and the label reads "Wednesday, evening: most to a few free, busy".
     */
    groupBands?: GroupBandShare[][];
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
export function WeekStrip({ slots, hours, day, onPick, groupBands }: WeekStripProps): JSX.Element {
    return (
        <div className="grid flex-none grid-cols-7 gap-1 pt-2" data-testid="phone-week-strip">
            {FULL_DAYS.map((name, d) => (
                <StripColumn
                    key={name}
                    dayOfWeek={d}
                    active={d === day}
                    label={groupBands
                        ? groupStripLabel(d, groupBands[d] ?? [])
                        : dayStripLabel(d, freeHourCount(slots, d, hours))}
                    bars={groupBands ? groupBars(groupBands[d] ?? []) : viewerBars(slots, d)}
                    onPick={onPick}
                />
            ))}
        </div>
    );
}

/** One day's column: its three band bars and its letter. */
function StripColumn({ dayOfWeek, active, label, bars, onPick }: {
    dayOfWeek: number; active: boolean; label: string; bars: BarSpec[];
    onPick: (dayOfWeek: number) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            aria-current={active ? 'date' : undefined}
            onClick={() => onPick(dayOfWeek)}
            data-testid={`phone-week-strip-day-${dayOfWeek}`}
            className={`flex flex-col gap-0.5 rounded-md border p-1 ${
                active ? 'border-emerald-500 bg-emerald-500/10' : 'border-edge bg-panel'
            }`}
        >
            {STRIP_BANDS.map((band, i) => (
                <BandBar
                    key={band.id}
                    band={band}
                    bar={bars[i] ?? { kind: 'none', otherKind: null, busy: false }}
                />
            ))}
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
 * Fill for a GROUP band (ROK-1580) — the same green / amber / red ramp the
 * heatmap cells use, so the strip summarises what is under it rather than
 * introducing a second colour language.
 */
const GROUP_FILL: Record<GroupBandKind, string> = {
    all: 'bg-emerald-500',
    most: 'bg-amber-500/70',
    few: 'bg-red-500/50',
    none: 'bg-edge',
};

/** The class for a bar, whichever of the two kind spaces it came from. */
function bandFill(kind: StripKind): string {
    return kind in GROUP_FILL ? GROUP_FILL[kind as GroupBandKind] : BAND_FILL[kind as BandKind];
}

/**
 * Heat colours for the two-tone gradient (ROK-1584).
 *
 * The same ramp `GROUP_FILL` paints as classes, as CSS values — a gradient
 * cannot be expressed in two Tailwind classes. They are the THEME variables
 * behind those classes (`--color-emerald-500` etc., which the schemes remap),
 * never literal rgba (review MAJOR-2); the alpha comes from `color-mix`, the
 * same way Tailwind's `/70` opacity modifier is built.
 */
const GROUP_GRADIENT: Record<GroupBandKind, string> = {
    all: 'var(--color-emerald-500)',
    most: 'color-mix(in srgb, var(--color-amber-500) 70%, transparent)',
    few: 'color-mix(in srgb, var(--color-red-500) 50%, transparent)',
    none: 'var(--color-edge)',
};

/**
 * One band of one day: all of it, some of it, or none of it.
 *
 * Flat fills only — ROK-1569's diagonal hatch for a stale week was ruled out on
 * 2026-09-16 (ROK-1579), so an unclaimed band reads the same however old the
 * viewer's saved week is.
 *
 * ROK-1584 (design §2) gave the group's bars two more jobs: a band whose hours
 * disagree splits into both tones across a sliver of the surface, and a band
 * with an hour someone is committed in wears a purple cap on its right 30%.
 */
function BandBar({ band, bar }: { band: StripBand; bar: BarSpec }): JSX.Element {
    const split = bar.otherKind !== null;
    return (
        <i
            data-testid="phone-week-strip-bar"
            data-band={band.id}
            data-kind={bar.kind}
            data-two-tone={bar.otherKind ?? undefined}
            className={`relative block h-[5px] overflow-hidden rounded-[1px] ${
                split ? 'strip-bar-split' : bandFill(bar.kind)
            }`}
            style={split ? {
                '--bar-l': GROUP_GRADIENT[bar.kind as GroupBandKind],
                '--bar-r': GROUP_GRADIENT[bar.otherKind as GroupBandKind],
            } as CSSProperties : undefined}
        >
            {bar.busy && (
                <span
                    data-busy="true"
                    className="absolute inset-y-0 right-0 w-[30%] bg-busy"
                />
            )}
        </i>
    );
}
