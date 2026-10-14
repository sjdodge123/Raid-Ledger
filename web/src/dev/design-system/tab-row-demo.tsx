/**
 * TabRow for /dev/design-system (docs/design-system.md §3.1, ROK-1785).
 *
 * The real primitive + `useHashTab`, so clicking a tab writes this page's
 * `location.hash` and the row follows it (Back steps through the tabs). The
 * frame is narrow on purpose: on a phone, or in a side-by-side column, the row
 * scrolls sideways inside its own box with a thin scrollbar, never the page.
 * "Loot" is `hidden` and must not render. The panel id is `ds-tab-<id>` —
 * `tabPanelId('ds', id)`, never the bare id, so the hash never jumps the page.
 * Inside a family column the panel id is dropped (the demo renders twice).
 * Tokens only, so it flips with the colour family.
 */
import type { JSX } from 'react';
import { TabRow, type TabRowTab } from '../../components/ui/tab-row';
import { tabPanelId, useHashTab } from '../../components/ui/tab-row.helpers';
import { StateFrame } from './design-system-bits';
import { useIsScopedFamily } from './family-scope';

const TABS: TabRowTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'roster', label: 'Roster' },
    { id: 'raids', label: 'Raids' },
    { id: 'progression', label: 'Progression' },
    { id: 'loot', label: 'Loot', hidden: true },
    { id: 'resources', label: 'Resources' },
];
const IDS = TABS.filter((t) => !t.hidden).map((t) => t.id);

export function TabRowDemo(): JSX.Element {
    const [active] = useHashTab(IDS, 'overview');
    const scoped = useIsScopedFamily();
    const label = TABS.find((t) => t.id === active)?.label ?? 'Overview';
    return (
        <StateFrame label="TabRow — hash-synced tab links" note="Click a tab: the URL hash changes and Back returns. Narrow the window: the row scrolls, the page doesn't.">
            <div className="w-full min-w-0" data-testid="ds-tab-row">
                <TabRow tabs={TABS} activeId={active} label="Demo page sections" className="mb-3" />
                <div id={scoped ? undefined : tabPanelId('ds', active)} role="region" aria-label={label}
                    className="rounded-lg border border-edge bg-surface p-3 text-sm text-secondary">
                    {label} panel
                </div>
            </div>
        </StateFrame>
    );
}
