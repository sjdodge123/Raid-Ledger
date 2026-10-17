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

/**
 * ROK-1788: lazy so the mirror (and its editor-only picker, a further lazy
 * chunk) stays out of the guild-page chunk. Fallback `null` matches the card's
 * own loading state, which renders nothing until the mirror query settles.
 */
const GuildDiscordMirror = lazy(() => import('./discord/guild-discord-mirror').then((m) => ({ default: m.GuildDiscordMirror })));

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

/** The core band. Module widgets land between these orders — WoW uses 50/60/80. */
function coreCells({ page, raids }: HubCtx): Cell[] {
    const data = raids.data;
    const cells: Cell[] = [
        { key: 'gm-post', order: 10, span: 1, node: <GmPostCard guildId={page.guild.id} canEdit={page.viewer.canEdit} /> },
        { key: 'discord', order: 20, span: 1, node: <Suspense fallback={null}><GuildDiscordMirror guildId={page.guild.id} canEdit={page.viewer.canEdit} /></Suspense> },
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

export function HubOverview({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    const cells = [...coreCells(ctx), ...moduleCells(ctx, mod)].sort((a, b) => a.order - b.order);
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3" data-testid="guild-overview">
            {cells.map((c) => (c.span === 2
                ? <div key={c.key} className={SPAN_2}>{c.node}</div>
                : <Fragment key={c.key}>{c.node}</Fragment>))}
        </div>
    );
}
