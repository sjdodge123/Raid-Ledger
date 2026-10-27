/**
 * ROK-1918 §3.3 — the hub widget catalog: every Overview widget this hub may
 * show this viewer, after the existing gates (core minus `coreWidgetVisible`,
 * module `visible`, `gatedHubGameWidgets`), each as a `HubLayoutEntry` plus the
 * node the Overview renders. `resolveHubLayout` orders and filters it; arrange
 * mode (L5) reads the same entries for its list and Add picker.
 *
 * The setup checklist is NOT in the catalog: it is editor-only, removes itself,
 * and always renders first (spec §2.2 rule 5). Generic widgets (`generic:*`,
 * Q5) join here in L7, default off.
 */
import type { ReactNode } from 'react';
import type { CoreWidgetId, HubCtx, HubModule } from '../../../plugins/hub-module';
import { GuildAttendance } from '../events/guild-attendance';
import { GuildEvents } from '../events/guild-events';
import { GuildRaidSchedule } from '../events/guild-raid-schedule';
import { gameWidgetCells } from '../hub-widget-cells';
import { hubCopy } from '../hub-copy';
import type { HubLayoutEntry } from './resolve-hub-layout';
import { LazyDiscordMirror, LazyLatestPostCard } from './core-widget-nodes';

const OVERVIEW_ATTENDANCE_TOP = 5;
/** "All events" always lands on the core Events tab now that one exists (ROK-1830 S3c). */
const EVENTS_TAB = 'events';

/** One catalog widget: layout metadata + what the Overview renders. */
export interface HubWidgetCell extends HubLayoutEntry {
    node: ReactNode;
    /** The Overview adds the `md:col-span-2` wrapper (core/module span 2); plugin cells carry their own span class. */
    wrap: boolean;
}

export interface HubCatalogOptions {
    onChangeChannel: (() => void) | null;
    activeSlugs: ReadonlySet<string>;
}

/** Mapped over `CoreWidgetId`, so a new core id that is not listed here fails to compile. */
const CORE_BAND: { readonly [K in CoreWidgetId]: K } = {
    'gm-post': 'gm-post', discord: 'discord', schedule: 'schedule', events: 'events', attendance: 'attendance',
};

/**
 * ROK-1969 — the core band's bare ids, declared under `core` in
 * `HUB_PLUGIN_MANIFESTS`; the ownership guard checks both lists match.
 */
export const CORE_BAND_IDS: readonly CoreWidgetId[] = Object.values(CORE_BAND);

type CoreSpec = { id: CoreWidgetId; order: number; span: 1 | 2; title: string; description: string; node: ReactNode };

function core(spec: CoreSpec): HubWidgetCell {
    const { order, ...rest } = spec;
    return { ...rest, defaultOrder: order, audience: 'everyone', defaultOn: true, wrap: spec.span === 2 };
}

/** The core band (10/20/30/40/70). Module widgets land between these orders — WoW uses 50/60. */
function coreSpecs(ctx: HubCtx, onChangeChannel: (() => void) | null): CoreSpec[] {
    const { page, raids } = ctx;
    const kind = page.guild.kind;
    const copy = hubCopy(kind);
    const cells: CoreSpec[] = [
        { id: 'gm-post', order: 10, span: 1, title: copy.leaderPostHeading, description: 'The latest leader post.', node: <LazyLatestPostCard guildId={page.guild.id} canEdit={page.viewer.canEdit} isLeader={page.viewer.role === 'leader'} kind={kind} canOpenPosts={page.viewer.role !== 'visitor'} /> },
        { id: 'discord', order: 20, span: 1, title: 'Discord channel', description: 'Recent messages from a linked Discord channel.', node: <LazyDiscordMirror guildId={page.guild.id} canEdit={page.viewer.canEdit} onChangeChannel={onChangeChannel} kind={page.guild.kind} /> },
    ];
    const data = raids.data;
    if (!data) return cells;
    return [
        ...cells,
        { id: 'schedule', order: 30, span: 1, title: copy.scheduleTitle, description: 'Repeating sessions.', node: <GuildRaidSchedule schedule={data.schedule} kind={kind} /> },
        { id: 'events', order: 40, span: 2, title: copy.eventsTitle, description: 'Upcoming and recent events.', node: <GuildEvents raids={data} compact jumpTab={EVENTS_TAB} kind={kind} /> },
        { id: 'attendance', order: 70, span: 1, title: 'Attendance leaderboard', description: 'Who shows up most.', node: <GuildAttendance attendance={data.attendance} limit={OVERVIEW_ATTENDANCE_TOP} kind={kind} /> },
    ];
}

/** `role-composition` → `Role composition` — the fallback name for an untitled module widget. */
export function humaniseWidgetId(id: string): string {
    const words = id.replace(/[-_:]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function moduleCells(ctx: HubCtx, mod: HubModule | undefined): HubWidgetCell[] {
    return (mod?.overviewWidgets ?? [])
        .filter((w) => (w.visible ? w.visible(ctx) : true))
        .map((w) => ({
            id: `module:${w.id}`, title: w.title ?? humaniseWidgetId(w.id), ...(w.description === undefined ? {} : { description: w.description }),
            defaultOrder: w.order, span: w.span ?? 1, audience: 'everyone', defaultOn: w.defaultOn ?? true,
            wrap: w.span === 2, node: <w.component {...ctx} />,
        }));
}

function pluginCells(ctx: HubCtx, activeSlugs: ReadonlySet<string>): HubWidgetCell[] {
    return gameWidgetCells(ctx, activeSlugs).map(({ key, order, widget, node }) => ({
        id: key, title: widget.title, ...(widget.description === undefined ? {} : { description: widget.description }),
        defaultOrder: order, span: widget.span ?? 1, audience: widget.audience, defaultOn: widget.defaultOn ?? true,
        wrap: false, node,
    }));
}

/** Every Overview widget this hub may show this viewer — core, then module, then plugin (ties keep this order). */
export function buildHubWidgetCatalog(ctx: HubCtx, mod: HubModule | undefined, opts: HubCatalogOptions): HubWidgetCell[] {
    const visible = mod?.coreWidgetVisible;
    const coreBand = coreSpecs(ctx, opts.onChangeChannel).filter((c) => !visible || visible(c.id, ctx)).map(core);
    return [...coreBand, ...moduleCells(ctx, mod), ...pluginCells(ctx, opts.activeSlugs)];
}
