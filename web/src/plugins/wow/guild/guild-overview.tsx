/**
 * ROK-1785 — the Overview tab: the prototype's bento widget grid
 * (`layout/OverviewTab.tsx`) — 3 columns at ≥1024px, 2 at ≥768px, 1 on phone.
 * S1 ships the Members summary (+ the GM's "Page editors" card); S2 the GM
 * post (span 2, top); later stories
 * drop their widgets into the same grid.
 */
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { WidgetCard } from './guild-bits';
import { GuildEditorsCard } from './guild-editors-panel';
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

export function GuildOverview({ page }: { page: GuildPage }): JSX.Element {
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3" data-testid="guild-overview">
            <GmPostCard guildId={page.guild.id} canEdit={page.viewer.canEdit} />
            <MembersSummary page={page} />
            {page.viewer.canManageEditors && (
                <div className="md:col-span-2"><GuildEditorsCard page={page} /></div>
            )}
        </div>
    );
}
