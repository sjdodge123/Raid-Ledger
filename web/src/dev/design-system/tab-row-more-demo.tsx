/**
 * TabRow's "More" menu for /dev/design-system (docs/design-system.md §3.1,
 * ROK-1876 tab-row ruling 2026-10-21 option A).
 *
 * Two 320px frames (the narrowest phone): the first follows this page's hash,
 * so picking a tab from More moves the active underline onto the trigger
 * ("Planner ▾"); the second is pinned to a hidden active tab. Ids carry a
 * `hub-` prefix so they never collide with the TabRow demo's hash. Tokens only.
 */
import type { JSX } from 'react';
import { TabRow, type TabRowTab } from '../../components/ui/tab-row';
import { useHashTab } from '../../components/ui/tab-row.helpers';
import { StateFrame } from './design-system-bits';

const TABS: TabRowTab[] = [
    { id: 'hub-overview', label: 'Overview' },
    { id: 'hub-members', label: 'Members' },
    { id: 'hub-events', label: 'Events' },
    { id: 'hub-resources', label: 'Resources' },
    { id: 'hub-planner', label: 'Planner' },
    { id: 'hub-materials', label: 'Materials' },
    { id: 'hub-map', label: 'Map' },
];
const IDS = TABS.map((t) => t.id);

export function TabRowMoreDemo(): JSX.Element {
    const [active] = useHashTab(IDS, 'hub-overview');
    return (
        <StateFrame label="TabRow — More menu (phone)" note="320px wide: the tabs that fit stay, the rest go into More. A hidden active tab names the trigger, underlined.">
            <div className="flex w-full min-w-0 flex-col gap-4" data-testid="ds-tab-row-more">
                <div className="w-[320px] max-w-full">
                    <TabRow tabs={TABS} activeId={active} label="Demo hub sections" />
                </div>
                <div className="w-[320px] max-w-full">
                    <TabRow tabs={TABS} activeId="hub-planner" label="Demo hub sections, Planner active" />
                </div>
            </div>
        </StateFrame>
    );
}
