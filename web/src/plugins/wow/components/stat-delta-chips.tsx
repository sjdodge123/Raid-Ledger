/**
 * ROK-2176: per-stat delta chips on a Boss & Loot row (row deltas option 1).
 * Desktop: every non-zero change. Phone (≤768px): the 3 largest stat changes
 * (armor / bonus armor / DPS never rank) then "+N more", which opens the
 * compare popup through `onOpen`.
 */
import { useMediaQuery } from '../../../hooks/use-media-query';
import { deltaTone, formatDelta, nonZeroDeltas, topDeltas, type StatDelta } from '../lib/item-stat-diff';
import './item-comparison.css';

const PHONE_CHIP_COUNT = 3;

export interface StatDeltaChipsProps {
    deltas: StatDelta[];
    /** Opens the compare popup; "+N more" calls it. */
    onOpen?: (() => void) | undefined;
}

function MoreChip({ more, onOpen }: { more: number; onOpen?: (() => void) | undefined }) {
    const label = `+${more} more`;
    if (!onOpen) return <span className="stat-delta-chip stat-delta-chip--more">{label}</span>;
    return (
        <button type="button" className="stat-delta-chip stat-delta-chip--more" onClick={onOpen}
            aria-label={`${label} stat changes — open comparison`}>
            {label}
        </button>
    );
}

export function StatDeltaChips({ deltas, onOpen }: StatDeltaChipsProps) {
    const isPhone = useMediaQuery('(max-width: 768px)');
    const { shown, more } = isPhone ? topDeltas(deltas, PHONE_CHIP_COUNT) : { shown: nonZeroDeltas(deltas), more: 0 };
    if (shown.length === 0 && more === 0) return null;
    return (
        <span className="stat-delta-chips" data-testid="stat-delta-chips">
            {shown.map((d) => (
                <span key={d.key} className={`stat-delta-chip stat-delta-chip--${deltaTone(d.value)}`}
                    data-tone={deltaTone(d.value)}>
                    {formatDelta(d)}
                </span>
            ))}
            {more > 0 && <MoreChip more={more} onOpen={onOpen} />}
        </span>
    );
}
