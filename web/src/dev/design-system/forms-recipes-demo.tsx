/**
 * Forms section, part 3 (ROK-1653): two recipes built from existing primitives,
 * documented in docs/design-system.md §4.11.
 *
 * - The segmented filter with an "All" sentinel — `RadioGroup` values are
 *   strings, so "no filter" is a reserved value mapped to `null` at the
 *   boundary (as `pages/admin/cron-jobs-panel.tsx::ThemeFilter` does).
 * - The row action menu — `Button role="menuitem"` rows, ghost or
 *   destructive-soft, left-aligned by widening the label span (as
 *   `components/admin/UserManagementRow.tsx::ActionMenuList` does). Shown open
 *   and static here; the real one is a popover.
 *
 * Check both families with the side-by-side toggle: the segmented ON state is
 * `bg-overlay`, and the destructive-soft rows are `danger` tints — tokens only.
 */
import { useState, type JSX } from 'react';
import { NoSymbolIcon, PencilSquareIcon, UserMinusIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { RadioGroup } from '../../components/ui/radio-group';
import { StateFrame } from './design-system-bits';

/** The radio value standing for "no filter" (the state holds `null`). */
const ALL = '__all__';
const DEMO_JOBS = ['Discord', 'Discord', 'Events', 'Events', 'Events', 'Maintenance'];
const THEMES = [...new Set(DEMO_JOBS)];

function SegmentedAllFilterDemo(): JSX.Element {
    const [theme, setTheme] = useState<string | null>(null);
    const count = (t: string) => DEMO_JOBS.filter((job) => job === t).length;
    const options = [
        { value: ALL, label: `All (${DEMO_JOBS.length})` },
        ...THEMES.map((t) => ({ value: t, label: `${t} (${count(t)})` })),
    ];
    return (
        <StateFrame label="RadioGroup — segmented filter with an All sentinel" note="'__all__' ↔ null at the boundary; All is the only reset (a radio can't un-check).">
            <div className="max-w-full overflow-x-auto">
                <RadioGroup appearance="segmented" label="Filter by theme" hideLabel options={options}
                    className="[&_label]:whitespace-nowrap" value={theme ?? ALL}
                    onChange={(v) => setTheme(v === ALL ? null : v)} />
            </div>
            <span className="text-xs text-muted">
                {theme === null ? `Showing all ${DEMO_JOBS.length} jobs` : `Showing ${count(theme)} ${theme} jobs`}
            </span>
        </StateFrame>
    );
}

/** Button centres its label with no tailwind-merge — widen the label span to left-align. */
const MENU_ITEM_LEFT = '[&>[data-button-label]]:w-full';
const MENU_ITEMS = [
    { label: 'Edit role', icon: <PencilSquareIcon className="w-4 h-4" />, destructive: false },
    { label: 'Kick', icon: <UserMinusIcon className="w-4 h-4" />, destructive: true },
    { label: 'Ban', icon: <NoSymbolIcon className="w-4 h-4" />, destructive: true },
];

function RowMenuDemo(): JSX.Element {
    return (
        <StateFrame label="Button — row action menu" note="role=menuitem rows: ghost, destructive-soft for Kick / Ban / Remove; no new tone prop.">
            <div role="menu" aria-label="Row actions" className="min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg p-1 flex flex-col gap-1">
                {MENU_ITEMS.map((item) => (
                    <Button key={item.label} role="menuitem" variant={item.destructive ? 'destructive-soft' : 'ghost'}
                        size="sm" fullWidth className={MENU_ITEM_LEFT}>
                        {item.icon}{item.label}
                    </Button>
                ))}
            </div>
        </StateFrame>
    );
}

/** The segmented "All" filter and the row-menu recipe, for the Forms section grid. */
export function RecipeStates(): JSX.Element {
    return (
        <>
            <SegmentedAllFilterDemo />
            <RowMenuDemo />
        </>
    );
}
