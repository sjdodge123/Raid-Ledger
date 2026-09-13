/**
 * The filtering pattern, side by side (ROK-1539) — the divergence that caused
 * this whole reference page to be commissioned.
 *
 * LEFT  (DO):    the real `FilterPanel` + `FilterPanelTrigger`, as /games and
 *                /players use them.
 * RIGHT (DON'T): a STATIC reproduction of the layout in
 *                `components/lineups/CommonGroundFilters.tsx`. Deliberately a
 *                copy and not an import — the real component carries an
 *                auto-seed effect and an API param type, and this page must not
 *                imply it is a primitive anyone should reuse.
 */
import { useState, type JSX } from 'react';
import { FilterPanel, FilterPanelTrigger } from '../../components/ui/filter-panel';
import { Section, DoBlock, DontBlock, SideBySide } from './design-system-bits';

const SLIDER_CLS = 'flex-1 h-11 accent-emerald-500';

function DemoSlider({ label, value, max }: { label: string; value: string; max: number }): JSX.Element {
    return (
        <label className="flex items-center gap-3 text-base text-foreground min-h-[44px]">
            <span className="whitespace-nowrap font-medium">{label}</span>
            <input
                type="range"
                min={0}
                max={max}
                defaultValue={Number(value)}
                className={`${SLIDER_CLS} pointer-events-none`}
                aria-disabled="true"
                tabIndex={-1}
            />
            <span className="text-sm font-mono w-8 text-right text-foreground">{value}</span>
        </label>
    );
}

const DO_NOTES = [
    'Funnel trigger with a result-count badge (hidden at zero)',
    'Panel owns the "Filters" title and "Clear all"',
    'Collapses; becomes a BottomSheet below 768px for free',
    'Escape closes the desktop panel where the consumer wires it (coop-filter-section.tsx)',
];

const DONT_NOTES = [
    'No funnel trigger — the controls always occupy the page',
    'No result-count badge, so "are filters on?" is unanswerable at a glance',
    'No "Clear all" — every control must be reset by hand',
    'No collapse and no mobile sheet; the grid just reflows',
];

/** Bullet list under an example. */
function Notes({ items, tone }: { items: string[]; tone: 'do' | 'dont' }): JSX.Element {
    const cls = tone === 'do' ? 'text-emerald-300/80' : 'text-red-300/80';
    return (
        <ul className={`text-[10px] mt-2 space-y-0.5 ${cls}`}>
            {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
    );
}

/** The three controls rendered as FilterPanel children. */
function DemoFilterControls(): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            <DemoSlider label="Min owners" value="2" max={15} />
            <DemoSlider label="Players" value="4" max={16} />
            <label className="flex items-center gap-2 text-base text-foreground min-h-[44px]">
                <input type="checkbox" defaultChecked className="w-5 h-5 accent-emerald-500" />
                <span className="font-medium">Co-op for our group size</span>
            </label>
        </div>
    );
}

/** The canonical pattern: funnel trigger with count badge, collapsible panel, Clear all. */
function CanonicalFiltering(): JSX.Element {
    const [isOpen, setIsOpen] = useState(true);
    const [activeCount, setActiveCount] = useState(2);
    return (
        <div data-testid="ds-filter-do">
            <div className="flex items-center gap-3 mb-2">
                <FilterPanelTrigger resultCount={37} hasActiveFilters={activeCount > 0} onClick={() => setIsOpen((v) => !v)} />
                <p className="text-xs text-muted">Showing games with co-op data</p>
            </div>
            <FilterPanel
                activeFilterCount={activeCount}
                onClearAll={() => setActiveCount(0)}
                isOpen={isOpen}
                onToggle={() => setIsOpen((v) => !v)}
            >
                <DemoFilterControls />
            </FilterPanel>
            <Notes items={DO_NOTES} tone="do" />
        </div>
    );
}

/** Static reproduction of the bespoke lineup filter bar — see the file header. */
function BespokeFiltering(): JSX.Element {
    return (
        <div data-testid="ds-filter-dont">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <input
                    type="search"
                    placeholder="Search games..."
                    aria-label="Search games (static example)"
                    readOnly
                    className="min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground placeholder:text-dim w-full"
                />
                <DemoSlider label="Min owners" value="2" max={15} />
                <DemoSlider label="Players" value="4" max={16} />
                <label className="flex items-center gap-2 text-base text-foreground min-h-[44px]">
                    <input
                        type="checkbox"
                        className="w-5 h-5 accent-emerald-500 pointer-events-none"
                        aria-disabled="true"
                        tabIndex={-1}
                    />
                    <span className="font-medium">Co-op for our group size</span>
                </label>
            </div>
            <Notes items={DONT_NOTES} tone="dont" />
        </div>
    );
}

/** Filtering: the canonical primitive beside the divergence it should replace. */
export function FilteringSection(): JSX.Element {
    return (
        <Section
            id="filtering"
            title="Pattern — filtering"
            blurb="Same job, two designs. The left is the shared primitive used by /games and /players; the right is the lineup's bespoke bar. Unifying them is divergence #1 in docs/design-system.md §6."
        >
            <SideBySide>
                <DoBlock title="components/ui/filter-panel.tsx">
                    <CanonicalFiltering />
                </DoBlock>
                <DontBlock title="components/lineups/CommonGroundFilters.tsx">
                    <BespokeFiltering />
                </DontBlock>
            </SideBySide>
        </Section>
    );
}
