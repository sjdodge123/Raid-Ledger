import type { CSSProperties, JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { FULL_DAYS } from '../game-time-grid.utils';
import {
    bandKind, bandShares, dayStripLabel, freeHourCount, STRIP_BANDS, type StripBand,
} from './phone-week.utils';
import {
    groupBandKind, groupStripLabel, type GroupBandKind, type GroupBandShare,
} from './group-day.utils';
import { bandFill, GROUP_GRADIENT, type StripKind } from './week-strip.fills';

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
    /**
     * Days of the week the viewer is away (ROK-1585, Q1) — from
     * `awayDaysOfWeek`. Each reads as a dashed "away" tile; ignored in group mode.
     */
    awayDays?: ReadonlySet<number>;
    /**
     * GROUP mode (ROK-1587): poll slots starting on each day of the displayed
     * week, index 0 = Sunday — from `slotCountsByDay`. Read only with `groupBands`.
     */
    groupVotes?: number[];
}

/** ", 2 suggested times" — the strip column's vote clause; empty for none. */
function votesClause(count: number): string {
    if (count <= 0) return '';
    return `, ${count} suggested time${count === 1 ? '' : 's'}`;
}

/** The accessible name of one strip column, whichever mode it is in. */
function columnLabel(props: WeekStripProps, d: number, away: boolean): string {
    const { slots, hours, groupBands, groupVotes } = props;
    if (groupBands) return groupStripLabel(d, groupBands[d] ?? []) + votesClause(groupVotes?.[d] ?? 0);
    const label = dayStripLabel(d, freeHourCount(slots, d, hours));
    return away ? `${label}, away` : label;
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
export function WeekStrip(props: WeekStripProps): JSX.Element {
    const { slots, day, onPick, groupBands, awayDays, groupVotes } = props;
    return (
        <div className="grid flex-none grid-cols-7 gap-1 pt-2" data-testid="phone-week-strip">
            {FULL_DAYS.map((name, d) => {
                // Away is the viewer's own fact — the group's week never shows it.
                const away = !groupBands && Boolean(awayDays?.has(d));
                return (
                    <StripColumn
                        key={name}
                        dayOfWeek={d}
                        active={d === day}
                        away={away}
                        label={columnLabel(props, d, away)}
                        bars={groupBands ? groupBars(groupBands[d] ?? []) : viewerBars(slots, d)}
                        votes={groupBands ? (groupVotes?.[d] ?? 0) : undefined}
                        onPick={onPick}
                    />
                );
            })}
        </div>
    );
}

/**
 * The column's border + fill. Only `border-*` / `bg-*` classes may differ
 * between columns (ROK-1579: every column is the same size). An away day is
 * dashed; a selected away day keeps the selected colours on the dashed border.
 */
function columnTone(active: boolean, away: boolean): string {
    if (active) return `${away ? 'border-dashed ' : ''}border-success bg-success/10`;
    return away ? 'border-dashed border-edge-strong bg-overlay/40' : 'border-edge bg-panel';
}

/**
 * One day's column: its three band bars (or the "away" label), its letter and,
 * in group mode, the "● N" vote marker under the letter (`votes` given).
 */
function StripColumn({ dayOfWeek, active, away, label, bars, votes, onPick }: {
    dayOfWeek: number; active: boolean; away: boolean; label: string; bars: BarSpec[];
    votes?: number; onPick: (dayOfWeek: number) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            aria-current={active ? 'date' : undefined}
            onClick={() => onPick(dayOfWeek)}
            data-testid={`phone-week-strip-day-${dayOfWeek}`}
            data-away={away ? 'true' : undefined}
            className={`flex flex-col gap-0.5 rounded-md border p-1 ${columnTone(active, away)}`}
        >
            {away ? <AwayLabel /> : STRIP_BANDS.map((band, i) => (
                <BandBar
                    key={band.id}
                    band={band}
                    bar={bars[i] ?? { kind: 'none', otherKind: null, busy: false }}
                />
            ))}
            <span className={`pt-0.5 text-center text-[10px] ${active ? 'text-foreground' : 'text-dim'}`}>
                {FULL_DAYS[dayOfWeek][0]}
            </span>
            {votes !== undefined && <VotesMarker votes={votes} />}
        </button>
    );
}

/**
 * "● 2" under the day letter — how many poll slots already start that day
 * (ROK-1587, board P-a `.vm`). Rendered on EVERY group column, empty on a day
 * with none, so the 10px row keeps all seven columns the same height (ROK-1579).
 * Decorative: the column's aria-label carries ", N suggested times".
 */
function VotesMarker({ votes }: { votes: number }): JSX.Element {
    return (
        <span
            data-testid="phone-week-strip-votes"
            aria-hidden="true"
            className="block h-[10px] text-center text-[9px] font-semibold leading-[10px] text-slot"
        >
            {votes > 0 ? `● ${votes}` : ''}
        </span>
    );
}

/**
 * The word that stands in for an away day's three bars (ROK-1585 artboard).
 * 19px tall — three 5px bars plus two 2px gaps — so the tile keeps the height of
 * its neighbours.
 */
function AwayLabel(): JSX.Element {
    return (
        <span
            data-testid="phone-week-strip-away"
            className="block text-center text-[9px] font-semibold uppercase leading-[19px] text-muted"
        >
            away
        </span>
    );
}

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
