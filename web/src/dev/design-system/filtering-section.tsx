/**
 * The filtering pattern (ROK-1659) — one shape, chosen by viewport, through
 * `FilterEntry` (`web/src/components/ui/filter-entry.tsx`).
 *
 * LEFT  (desktop, ≥1024px):      the real `FilterEntryTrigger` (toolbar funnel)
 *                                + the inline panel `FilterEntry` renders —
 *                                mounted only at ≥1024px (below, the real entry
 *                                would float its fixed FAB over the gallery).
 * RIGHT (phone/tablet, <1024px): a static replica of the Filters FAB
 *                                (`FilterFab`, `filter-fab.tsx`) — the real
 *                                component is `fixed` + `lg:hidden`, so at this
 *                                page's desktop width it renders nothing and
 *                                would float over the whole gallery besides
 *                                (the same reason `overlays-section.tsx`'s FAB
 *                                example is a static replica). Only the
 *                                position is replicated: the face class
 *                                (`FILTER_FAB_FACE_CLASS`, `fab-position.ts`),
 *                                the count badge (`FilterCountBadge`) and the
 *                                `BottomSheet` on tap are the real ones.
 *
 * Before ROK-1659 this page compared the shared primitive against the lineup's
 * bespoke `CommonGroundFilters.tsx` bar (divergence #1, docs/design-system.md
 * §6). That divergence is resolved: Common Ground now uses this same
 * primitive, so both sides here are DO.
 */
import { useId, useState, type JSX } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { FilterEntry, FilterEntryTrigger } from '../../components/ui/filter-entry';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { FilterCountBadge } from '../../components/ui/filter-count-badge';
import { FILTER_FAB_FACE_CLASS } from '../../components/ui/fab-position';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { Section, DoBlock, SideBySide } from './design-system-bits';

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

const DESKTOP_NOTES = [
    'Toolbar funnel trigger with an active-filter-count badge (hidden at zero, not a result count)',
    'Panel owns the "Filters" title and "Clear all"',
    'Scrolls internally past its 500px cap for long bodies',
    'Escape closes the panel (filter-panel.tsx::useEscapeToClose)',
];

const PHONE_NOTES = [
    "No toolbar trigger below 1024px — FilterEntryTrigger renders nothing there",
    "Neutral tone (bg-surface, border-edge-strong) — it isn't the page's primary create action",
    'Opens the same controls, in the real BottomSheet',
    "Stacks 12px above a page's create FAB when both exist (fab-position.ts, design-system.md §4.1)",
];

/** Bullet list under an example. */
function Notes({ items }: { items: string[] }): JSX.Element {
    return (
        <ul className="text-[10px] mt-2 space-y-0.5 text-emerald-300/80">
            {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
    );
}

/** The three controls rendered as filter children. */
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

/**
 * Desktop (≥1024px): the real FilterEntry — toolbar trigger + inline panel.
 * Below 1024px the real entry would mount its `fixed` FilterFab over the whole
 * gallery (and swap the panel for a sheet), so only a note renders there.
 */
function DesktopFiltering(): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    return (
        <div data-testid="ds-filter-do">
            {isDesktop ? <LiveDesktopEntry /> : (
                <p className="text-xs text-muted">The live desktop entry renders at 1024px and up. Widen the window to try it.</p>
            )}
            <Notes items={DESKTOP_NOTES} />
        </div>
    );
}

/** The live toolbar funnel + inline panel (mounted only at ≥1024px, see `DesktopFiltering`). */
function LiveDesktopEntry(): JSX.Element {
    const [isOpen, setIsOpen] = useState(true);
    const [activeCount, setActiveCount] = useState(2);
    return (
        <>
            <div className="flex items-center gap-3 mb-2">
                <FilterEntryTrigger activeCount={activeCount} isOpen={isOpen} onOpenChange={setIsOpen} />
                <p className="text-xs text-muted">Showing games with co-op data</p>
            </div>
            <FilterEntry activeCount={activeCount} isOpen={isOpen} onOpenChange={setIsOpen} onClearAll={() => setActiveCount(0)}>
                <DemoFilterControls />
            </FilterEntry>
        </>
    );
}

/** Phone + tablet (<1024px): a static replica of FilterFab — see the file header. */
function PhoneFiltering(): JSX.Element {
    const [isOpen, setIsOpen] = useState(false);
    const countId = useId();
    const activeCount = 2;
    return (
        <div data-testid="ds-filter-phone" className="relative min-h-[140px]">
            <p className="text-xs text-muted mb-3">Showing games with co-op data</p>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                aria-label="Filters"
                aria-expanded={isOpen}
                aria-describedby={countId}
                className={`relative ${FILTER_FAB_FACE_CLASS}`}
            >
                <FunnelIcon className="w-6 h-6" aria-hidden="true" />
                <FilterCountBadge count={activeCount} id={countId} />
            </button>
            <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)} title="Filters">
                <DemoFilterControls />
            </BottomSheet>
            <Notes items={PHONE_NOTES} />
        </div>
    );
}

/** Filtering: the funnel standard, desktop toolbar beside its phone/tablet FAB. */
export function FilteringSection(): JSX.Element {
    return (
        <Section
            id="filtering"
            title="Pattern — filtering"
            blurb="One shape, chosen by viewport, through FilterEntry: a toolbar trigger + inline panel at 1024px and up, a Filters FAB opening the same panel as a sheet below it. /games, Common Ground and Calendar all use this (ROK-1659)."
        >
            <SideBySide>
                <DoBlock title="Desktop (≥1024px) — FilterEntry + FilterEntryTrigger">
                    <DesktopFiltering />
                </DoBlock>
                <DoBlock title="Phone + tablet (<1024px) — FilterFab (replica) + BottomSheet">
                    <PhoneFiltering />
                </DoBlock>
            </SideBySide>
        </Section>
    );
}
