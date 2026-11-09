/**
 * ShowAllToggle + useRowCap for /dev/design-system (docs/design-system.md §3,
 * ROK-2146). The REAL hook and toggle over 8 sample rows: the list shows 5, the
 * button reads "Show all 8" and flips to "Show fewer", with `aria-expanded` and
 * `aria-controls` pointing at the list. Tokens only, so it flips with the family.
 */
import { useId, type JSX } from 'react';
import { ShowAllToggle } from '../../plugins/wow/components/show-all-toggle';
import { useRowCap } from '../../plugins/wow/hooks/use-row-cap';
import { StateFrame } from './design-system-bits';

const ROWS = ['The Defias Brotherhood', 'Red Silk Bandanas', 'Underground Assault', 'The Unsent Letter',
    'Collecting Memories', 'Oh Brother. . .', 'Captain Sander\'s Hidden Treasure', 'The Coast Is Clear'] as const;

export function RowCapDemo(): JSX.Element {
    const listId = useId();
    const { visible, capped, expanded, toggle } = useRowCap(ROWS);
    return (
        <StateFrame label="ShowAllToggle — 5-row list cap" note="Lists longer than 5 rows show the first 5 and a Show all N / Show fewer button (quest log, completed-quest groups).">
            <div className="w-full min-w-0" data-testid="ds-row-cap">
                <ul id={listId} className="divide-y divide-edge rounded-lg border border-edge bg-surface text-sm text-foreground">
                    {visible.map((row) => <li key={row} className="px-3 py-2">{row}</li>)}
                </ul>
                {capped && <ShowAllToggle total={ROWS.length} expanded={expanded} onToggle={toggle} controls={listId} />}
            </div>
        </StateFrame>
    );
}
