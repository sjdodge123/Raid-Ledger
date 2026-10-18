/**
 * ROK-1785/ROK-1830 — the Overview tab: the prototype's bento widget grid
 * (`layout/OverviewTab.tsx`) — 3 columns at ≥1024px, 2 at ≥768px, 1 on phone.
 * Core contributes the leader post, the Discord mirror, the schedule, the
 * event list and attendance; the hub module's `overviewWidgets` are merged in
 * by `order`, which is what keeps a game's widgets in their prototype slots.
 */
import { Fragment, lazy, Suspense, type JSX, type ReactNode } from 'react';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { GuildAttendance } from './events/guild-attendance';
import { GuildEvents } from './events/guild-events';
import { GuildRaidSchedule } from './events/guild-raid-schedule';
import { GmPostCard } from './content/gm-post-card';
import { useHubSettings } from './settings/hub-settings-context';


/**
 * ROK-1788: lazy so the mirror (and its editor-only picker, a further lazy
 * chunk) stays out of the guild-page chunk. Fallback `null` matches the card's
 * own loading state, which renders nothing until the mirror query settles.
 */
const GuildDiscordMirror = lazy(() => import('./discord/guild-discord-mirror').then((m) => ({ default: m.GuildDiscordMirror })));

/**
 * ROK-1830 S5: lazy, and mounted only for an editor. The checklist, its step
 * derivation and the onboarding hook are dead weight for every member — and
 * they pushed the `hub-page` route chunk over its gzip budget (13.2 KB vs the
 * 12.6 KB cap the route carried before this story).
 */
const HubSetupChecklist = lazy(() => import('./onboarding/setup-checklist').then((m) => ({ default: m.HubSetupChecklist })));

const SPAN_2 = 'md:col-span-2';
const OVERVIEW_ATTENDANCE_TOP = 5;
/** "All events" always lands on the core Events tab now that one exists (ROK-1830 S3c). */
const EVENTS_TAB = 'events';

interface Cell {
    key: string;
    order: number;
    span: 1 | 2;
    node: ReactNode;
}

/** The core band. Module widgets land between these orders — WoW uses 50/60. */
function coreCells({ page, raids }: HubCtx, onChangeChannel: (() => void) | null, mods: ModsState): Cell[] {
    const data = raids.data;
    // Above everything on purpose: it is the one widget that tells an editor
    // what is still missing, and it removes itself once nothing is. A span-1
    // Fragment cell, not a span-2 <div>: the card renders null for a
    // dismissed or finished editor, and a wrapper would leave an empty grid
    // item (a dead `gap-4` row) above the first widget. The card carries its
    // own `md:col-span-2` when it does render.
    const checklist: Cell[] = page.viewer.canEdit
        ? [{
            key: 'setup-checklist', order: 5, span: 1,
            node: (
                <Suspense fallback={null}>
                    <HubSetupChecklist guildId={page.guild.id} canEdit guildName={page.guild.name} memberCount={page.guild.memberCount}
                        nextRaid={data === undefined ? undefined : data.nextRaid}
                        modsConfigured={mods.configured} hasModSources={mods.hasSources} />
                </Suspense>
            ),
        }]
        : [];
    const cells: Cell[] = [
        ...checklist,
        { key: 'gm-post', order: 10, span: 1, node: <GmPostCard guildId={page.guild.id} canEdit={page.viewer.canEdit} /> },
        { key: 'discord', order: 20, span: 1, node: <Suspense fallback={null}><GuildDiscordMirror guildId={page.guild.id} canEdit={page.viewer.canEdit} onChangeChannel={onChangeChannel} /></Suspense> },
    ];
    if (!data) return cells;
    cells.push({ key: 'schedule', order: 30, span: 1, node: <GuildRaidSchedule schedule={data.schedule} /> });
    cells.push({ key: 'events', order: 40, span: 2, node: <GuildEvents raids={data} compact jumpTab={EVENTS_TAB} /> });
    cells.push({ key: 'attendance', order: 70, span: 1, node: <GuildAttendance attendance={data.attendance} limit={OVERVIEW_ATTENDANCE_TOP} /> });
    return cells;
}

function moduleCells(ctx: HubCtx, mod: HubModule | undefined): Cell[] {
    return (mod?.overviewWidgets ?? [])
        .filter((w) => (w.visible ? w.visible(ctx) : true))
        .map((w) => ({ key: `module:${w.id}`, order: w.order, span: w.span ?? 1, node: <w.component {...ctx} /> }));
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
    const cells = [...coreCells(ctx, openChannelPicker, mods), ...moduleCells(ctx, mod)].sort((a, b) => a.order - b.order);
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3" data-testid="guild-overview">
            {cells.map((c) => (c.span === 2
                ? <div key={c.key} className={SPAN_2}>{c.node}</div>
                : <Fragment key={c.key}>{c.node}</Fragment>))}
        </div>
    );
}
