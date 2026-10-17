/**
 * Quick-range chips for the away form (ROK-1585).
 *
 * New pattern: the ON state is the green accent from the approved away
 * artboards (operator Q3), not the amber filter-chip ON of design-system §4.3 —
 * these pick a value for a form rather than filter a list. Test ids are the
 * legacy `absence-pick-*` ones the smoke specs already use.
 */
import type { JSX } from 'react';
import type { AwayPick } from './away-panel.helpers';

const CHIPS: Array<{ kind: AwayPick; label: string }> = [
    { kind: 'weekend', label: 'This weekend' },
    { kind: 'next-week', label: 'Next week' },
    { kind: 'custom', label: 'Custom' },
];

const CHIP_BASE = 'min-h-[44px] rounded-full border px-3 text-sm font-medium transition-colors';
const CHIP_ON = 'border-emerald-500 bg-emerald-500/10 text-foreground';
const CHIP_OFF = 'border-edge-strong bg-surface text-muted hover:text-foreground';

/** Three 44px chips — This weekend · Next week · Custom — with `aria-pressed`. */
export function AwayRangeChips({ active, onPick }: {
    active: AwayPick | null;
    onPick: (kind: AwayPick) => void;
}): JSX.Element {
    return (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Quick ranges">
            {CHIPS.map(({ kind, label }) => (
                <button
                    key={kind} type="button" aria-pressed={active === kind}
                    data-testid={`absence-pick-${kind}`} onClick={() => onPick(kind)}
                    className={`${CHIP_BASE} ${active === kind ? CHIP_ON : CHIP_OFF}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
