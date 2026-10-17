/**
 * ROK-1830 — the WoW guild's Overview widgets: role composition (50) and the
 * members summary with its per-rank counts (60). Core's own widgets sit on
 * 10/20/30/40/70, so these two keep the prototype's bento order exactly. The
 * page-editors card (80) left in S4 — editors live in the settings sheet now.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { WidgetCard } from '../../../components/hub/hub-bits';
import { GuildRoleComposition } from './role-composition';
import { RoleSummary } from './role-bits';
import { rankLabel } from './wow-guild.helpers';

function RankCounts({ page }: HubCtx): JSX.Element {
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
function SeeMembersLink(): JSX.Element {
    return (
        <a href="#members" data-testid="guild-see-members"
            className={`rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>
            See members
        </a>
    );
}

export function WowMembersSummary(ctx: HubCtx): JSX.Element {
    const { page } = ctx;
    return (
        <WidgetCard id="members-summary" title={`Members · ${page.guild.memberCount}`} action={<SeeMembersLink />}>
            <div className="flex flex-col gap-3" data-testid="guild-members-summary">
                <RoleSummary counts={page.roleCounts} />
                <RankCounts {...ctx} />
            </div>
        </WidgetCard>
    );
}

export function WowRoleCompositionWidget({ raids }: HubCtx): JSX.Element | null {
    return raids.data ? <GuildRoleComposition composition={raids.data.composition} /> : null;
}
