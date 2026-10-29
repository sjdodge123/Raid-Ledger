/**
 * ROK-1785/ROK-1830 — the Overview tab: the prototype's bento widget grid
 * (`layout/OverviewTab.tsx`) — 3 columns at ≥1024px, 2 at ≥768px, 1 on phone.
 * Core contributes the leader post, the Discord mirror, the schedule, the
 * event list and attendance; the hub module's `overviewWidgets` are merged in
 * by `order`, which is what keeps a game's widgets in their prototype slots.
 * ROK-1909: plugin game widgets (`registerHubWidget`) join the same sort.
 * ROK-1918: cells come from `layout/hub-widget-catalog`, ordered and filtered
 * by the hub's saved `widgetPrefs` through `layout/resolve-hub-layout`.
 * ROK-1941 D14: the Gallery dialog is mounted here once, so a widget can open
 * it even when the Gallery card is hidden.
 * ROK-2043: masonry pack at ≥768px — each card keeps its slot in the arranged
 * order and its span, and starts right under the card above it
 * (`layout/use-masonry-rows`), so a short card no longer leaves a row-tall hole.
 */
import { Fragment, lazy, Suspense, useRef, useState, type JSX, type ReactNode } from 'react';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { useHubSettings } from './settings/hub-settings-context';
import { usePluginStore } from '../../stores/plugin-store';
import { canInvite } from './community/community-invite-access';
import { buildHubWidgetCatalog, type HubWidgetCell } from './layout/hub-widget-catalog';
import { resolveHubLayout } from './layout/resolve-hub-layout';
import { HubGalleryDialogMount } from './gallery/hub-gallery-dialog-mount';
import { MASONRY_GRID_CLASS, useMasonryRows } from './layout/use-masonry-rows';

/**
 * ROK-1830 S5: lazy, and mounted only for an editor. The checklist, its step
 * derivation and the onboarding hook are dead weight for every member — and
 * they pushed the `hub-page` route chunk over its gzip budget (13.2 KB vs the
 * 12.6 KB cap the route carried before this story).
 */
const loadOverviewEditorTools = () => import('./overview-editor-tools');
const HubSetupChecklist = lazy(() => loadOverviewEditorTools().then((m) => ({ default: m.HubSetupChecklist })));

/** ROK-1918 L5: Arrange button + arrange mode, editor-only — same loader, so no second preload list (see `overview-editor-tools`). */
const HubArrangeGate = lazy(() => loadOverviewEditorTools().then((m) => ({ default: m.HubArrangeGate })));

const SPAN_2 = 'md:col-span-2';

/**
 * Above everything on purpose: it is the one widget that tells an editor what
 * is still missing, and it removes itself once nothing is. Not arrangeable
 * (ROK-1918 §2.2 rule 5). A Fragment, not a span-2 <div>: the card renders null
 * for a dismissed or finished editor, and a wrapper would leave an empty grid
 * item (a dead `gap-4` row) above the first widget. The card carries its own
 * `md:col-span-2` when it does render.
 */
function SetupChecklistCell({ ctx, mods }: { ctx: HubCtx; mods: ModsState }): JSX.Element | null {
    const { page, raids } = ctx;
    if (!page.viewer.canEdit) return null;
    const data = raids.data;
    return (
        <Suspense fallback={null}>
            <HubSetupChecklist guildId={page.guild.id} canEdit guildName={page.guild.name} memberCount={page.guild.memberCount}
                nextRaid={data === undefined ? undefined : data.nextRaid}
                modsConfigured={mods.configured} hasModSources={mods.hasSources} kind={page.guild.kind} canInvite={canInvite(ctx)} />
        </Suspense>
    );
}

function WidgetCell({ cell }: { cell: HubWidgetCell }): JSX.Element {
    return cell.wrap ? <div className={SPAN_2}>{cell.node}</div> : <Fragment>{cell.node}</Fragment>;
}

/**
 * ROK-2043: the bento grid — 3 columns ≥1024px, 2 ≥768px, masonry-packed there;
 * one plain stack on phone. Plain row flow, never `grid-flow-dense`: dense would
 * pull later cards up into earlier holes and scramble the arranged order.
 */
function OverviewGrid({ hidden, children }: { hidden: boolean; children: ReactNode }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useMasonryRows(ref);
    return (
        <div ref={ref} hidden={hidden} className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${MASONRY_GRID_CLASS}`} data-testid="guild-overview">
            {children}
        </div>
    );
}

/** Whether the hub kind has mod sources at all, and whether any reports content. */
export interface ModsState {
    hasSources: boolean;
    configured: boolean;
}

interface HubOverviewProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    mods: ModsState;
}

export function HubOverview({ ctx, module: mod, mods }: HubOverviewProps): JSX.Element {
    const { openChannelPicker } = useHubSettings();
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const catalog = buildHubWidgetCatalog(ctx, mod, { onChangeChannel: openChannelPicker, activeSlugs });
    // ROK-1918: the hub's saved layout; `null`/absent = registry default (the pre-1918 Overview).
    const prefs = ctx.page.widgetPrefs ?? null;
    const layout = resolveHubLayout(catalog, prefs, ctx.page.viewer);
    const { page } = ctx;
    // Arrange mode belongs to ONE hub (0 = not arranging; ids are positive) and
    // needs edit rights. A switch to another cached hub (same tree position) or a
    // refetch that drops `canEdit` leaves it in the same commit — arrange mode
    // unmounts, its draft goes with it, and the grid shows again. The gate clears
    // the stale id (`hub-arrange-gate`), keeping the bytes out of `hub-page`.
    const [arrangingFor, setArrangingFor] = useState(0);
    const arranging = page.viewer.canEdit && arrangingFor === page.guild.id;
    // One tree position for the grid (hidden, not unmounted, while arranging):
    // the editor chunk loading and leaving arrange mode never remount a widget.
    const grid = (
        <OverviewGrid hidden={arranging}>
            <SetupChecklistCell ctx={ctx} mods={mods} />
            {layout.visible.map((c) => <WidgetCell key={c.id} cell={c} />)}
        </OverviewGrid>
    );
    const gallery = <HubGalleryDialogMount guildId={page.guild.id} canEdit={page.viewer.canEdit} />;
    if (!page.viewer.canEdit) return <>{grid}{gallery}</>;
    return (
        <>
            <Suspense fallback={null}>
                <HubArrangeGate guildId={page.guild.id} kind={page.guild.kind} layout={layout} prefs={prefs}
                    raidsUnavailable={ctx.raids.data === undefined} arranging={arranging} onArrange={(on) => setArrangingFor(on ? page.guild.id : 0)} />
            </Suspense>
            {grid}
            {gallery}
        </>
    );
}
