/**
 * ROK-1785/ROK-1830 — the Overview tab: the prototype's bento widget grid
 * (`layout/OverviewTab.tsx`) — 3 columns at ≥1024px, 2 at ≥768px, 1 on phone.
 * Core contributes the leader post, the Discord mirror, the schedule, the
 * event list and attendance; the hub module's `overviewWidgets` are merged in
 * by `order`, which is what keeps a game's widgets in their prototype slots.
 * ROK-1909: plugin game widgets (`registerHubWidget`) join the same sort.
 * ROK-1918: cells come from `layout/hub-widget-catalog`, ordered and filtered
 * by the hub's saved `widgetPrefs` through `layout/resolve-hub-layout`.
 */
import { Fragment, lazy, Suspense, type JSX } from 'react';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { useHubSettings } from './settings/hub-settings-context';
import { usePluginStore } from '../../stores/plugin-store';
import { canInvite } from './community/community-invite-access';
import { buildHubWidgetCatalog, type HubWidgetCell } from './layout/hub-widget-catalog';
import { resolveHubLayout } from './layout/resolve-hub-layout';

/**
 * ROK-1830 S5: lazy, and mounted only for an editor. The checklist, its step
 * derivation and the onboarding hook are dead weight for every member — and
 * they pushed the `hub-page` route chunk over its gzip budget (13.2 KB vs the
 * 12.6 KB cap the route carried before this story).
 */
const HubSetupChecklist = lazy(() => import('./onboarding/setup-checklist').then((m) => ({ default: m.HubSetupChecklist })));

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
    const { visible } = resolveHubLayout(catalog, ctx.page.widgetPrefs ?? null, ctx.page.viewer);
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3" data-testid="guild-overview">
            <SetupChecklistCell ctx={ctx} mods={mods} />
            {visible.map((c) => <WidgetCell key={c.id} cell={c} />)}
        </div>
    );
}
