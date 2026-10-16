/**
 * ROK-1785 — the Overview tab: the prototype's bento widget grid
 * (`layout/OverviewTab.tsx`) — 3 columns at ≥1024px, 2 at ≥768px, 1 on phone.
 * S1 ships the Members summary (+ the GM's "Page editors" card); S2 (ROK-1786)
 * the GM post (span 2, top); S3 (ROK-1787) the raid schedule, events, role
 * composition and attendance widgets in the prototype's order; S4 (ROK-1788)
 * the read-only Discord channel mirror (span 2, after the GM post). Raid widgets
 * wait for their payload (no layout jump).
 */
import { lazy, Suspense, type JSX } from 'react';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { WidgetCard } from './guild-bits';
import { GuildAttendance } from './guild-attendance';
import { GuildEditorsCard } from './guild-editors-panel';
import { GuildEvents } from './guild-events';
import { GuildRaidSchedule } from './guild-raid-schedule';
import { GuildRoleComposition } from './guild-role-composition';
import { GmPostCard } from './gm-post-card';
import { rankLabel } from './guild-roster.helpers';
import { RoleSummary } from './role-bits';

function RankCounts({ page }: { page: GuildPage }): JSX.Element {
    return (
        <ul aria-label="Members per rank" className="flex flex-col">
            {page.ranks.map((r) => (
                <li key={r.rankIndex ?? 'none'} className="flex items-baseline justify-between gap-2 border-b border-edge-subtle py-1.5 text-sm last:border-b-0">
                    <span className="text-secondary">{rankLabel(r)}</span>
                    <span className="font-semibold text-foreground">{r.members.length}</span>
                </li>
            ))}
        </ul>
    );
}

/** Plain `<a href>`: `useHashTab` follows hashchange, which a router `<Link>` never fires (L3 note). */
function SeeRosterLink(): JSX.Element {
    return (
        <a href="#roster" data-testid="guild-see-roster"
            className={`rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>
            See roster
        </a>
    );
}

function MembersSummary({ page }: { page: GuildPage }): JSX.Element {
    return (
        <WidgetCard id="members-summary" title={`Members · ${page.guild.memberCount}`} action={<SeeRosterLink />}>
            <div className="flex flex-col gap-3" data-testid="guild-members-summary">
                <RoleSummary counts={page.roleCounts} />
                <RankCounts page={page} />
            </div>
        </WidgetCard>
    );
}

/**
 * ROK-1788: lazy so the mirror (and its editor-only picker, a further lazy
 * chunk) stays out of the guild-page chunk. Fallback `null` matches the card's
 * own loading state, which renders nothing until the mirror query settles.
 */
const GuildDiscordMirror = lazy(() => import('./guild-discord-mirror').then((m) => ({ default: m.GuildDiscordMirror })));

const SPAN_2 = 'md:col-span-2';
const OVERVIEW_ATTENDANCE_TOP = 5;

export function GuildOverview({ page, raids }: { page: GuildPage; raids: GuildRaidsDto | undefined }): JSX.Element {
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3" data-testid="guild-overview">
            <GmPostCard guildId={page.guild.id} canEdit={page.viewer.canEdit} />
            <Suspense fallback={null}><GuildDiscordMirror guildId={page.guild.id} canEdit={page.viewer.canEdit} /></Suspense>
            {raids && <GuildRaidSchedule schedule={raids.schedule} />}
            {raids && <div className={SPAN_2}><GuildEvents raids={raids} compact /></div>}
            {raids && <GuildRoleComposition composition={raids.composition} />}
            <MembersSummary page={page} />
            {raids && <GuildAttendance attendance={raids.attendance} limit={OVERVIEW_ATTENDANCE_TOP} />}
            {page.viewer.canManageEditors && (
                <div className={SPAN_2}><GuildEditorsCard page={page} /></div>
            )}
        </div>
    );
}
