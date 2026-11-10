import { memo, type JSX } from 'react';
import type { HeatmapCellData } from '../game-time-grid.types';
import { computeHeatmapBg } from '../grid-cell.utils';
import { GroupCountClauses } from '../GroupCountClauses';
import { groupCellAriaLabel, votedLabel } from '../slot-marks.utils';
import { COUNT_CHIP, weekCellClass } from './group-marks.classes';

export interface GroupWeekCellProps {
    dayOfWeek: number;
    hour: number;
    cell?: HeatmapCellData | undefined;
    /** Summed votes of the poll slot(s) starting here; undefined = no slot. */
    votes?: number | undefined;
    picked: boolean;
    current: boolean;
    disabled: boolean;
    /** Absent = read-only: a labelled `role="img"` tile, not a tab stop. */
    onPick?: ((dayOfWeek: number, hour: number) => void) | undefined;
}

/**
 * "5 free · 1 busy · 1 stale" top-right on its surface chip (ROK-2167), the busy
 * clause in purple. `top-0.5`: a wrapped two-line chip (24px) then spans y 3–27
 * of the 40px cell — clear of the picked ring / slot outline above (y 1–3) and
 * of the `CornerLabel` below (y 27–37, `bottom-[3px]`), without overlapping either.
 */
function CellCount({ cell }: { cell?: HeatmapCellData | undefined }): JSX.Element | null {
    if (!cell) return null;
    return (
        <span data-testid="group-count-chip"
            className={`absolute right-[5px] top-0.5 text-[11px] leading-none text-foreground/85 ${COUNT_CHIP}`}>
            <GroupCountClauses cell={cell} />
        </span>
    );
}

/** Bottom-left corner label: the pick wins, then the current start, then the votes. */
function CornerLabel({ votes, picked, current }: Pick<GroupWeekCellProps, 'votes' | 'picked' | 'current'>): JSX.Element | null {
    const base = 'absolute bottom-[3px] left-[5px] text-[10px] font-semibold leading-none';
    if (picked) return <span className={`${base} text-success`}>Suggested</span>;
    if (current) return <span className={`${base} text-muted`}>Current</span>;
    if (votes !== undefined) return <span className={`${base} text-slot`}>{votedLabel(votes)}</span>;
    return null;
}

/** Truthy flag → `"true"`, else the attribute is omitted. */
const flag = (on: boolean): 'true' | undefined => (on ? 'true' : undefined);

/**
 * One (day, hour) of the desktop group week (ROK-1588). Every mark is a class
 * or a data attribute on this one element — no overlays, no measurement. The
 * fill is `computeHeatmapBg` inline (its alpha encodes the fresh share), shared
 * with the phone so the two surfaces never disagree.
 */
function GroupWeekCellImpl(props: GroupWeekCellProps): JSX.Element {
    const { dayOfWeek, hour, cell, votes, picked, current, disabled, onPick } = props;
    const busy = cell?.busy ?? 0;
    const shared = {
        'data-testid': `group-week-cell-${dayOfWeek}-${hour}`,
        'data-day': dayOfWeek,
        'data-hour': hour,
        'data-busy': busy > 0 ? String(busy) : undefined,
        'data-votes': votes !== undefined ? String(votes) : undefined,
        'data-picked': flag(picked),
        'data-current': flag(current),
        'aria-label': groupCellAriaLabel(dayOfWeek, hour, cell, { picked, current, ...(votes === undefined ? {} : { votes }) }),
        className: weekCellClass({ busy: busy > 0, slot: votes !== undefined, picked, disabled }),
        style: { background: computeHeatmapBg(cell) },
    };
    const body = <><CellCount cell={cell} /><CornerLabel votes={votes} picked={picked} current={current} /></>;
    if (!onPick) return <div role="img" {...shared}>{body}</div>;
    return (
        <button type="button" {...shared} aria-disabled={disabled || undefined}
            onClick={() => { if (!disabled) onPick(dayOfWeek, hour); }}>
            {body}
        </button>
    );
}

/** Memoised: primitive flags + a stable cell object, so a pick re-renders ≤2 cells. */
export const GroupWeekCell = memo(GroupWeekCellImpl);
