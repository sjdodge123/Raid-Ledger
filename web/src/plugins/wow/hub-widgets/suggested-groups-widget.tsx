/**
 * ROK-2212 — the Forever "Suggested groups" hub widget body: the best group of
 * each of the 3 best dungeons, then a footnote on who the pool held (unclaimed
 * roster rows included) and who it left out. Lazy-loaded by the register file.
 */
import type { JSX } from 'react';
import type { SuggestedGroupsPoolDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { CardFootnote, QuietEmpty } from '../../../components/hub/card-bits';
import { SuggestedGroupCard } from '../hub/suggested-groups/suggested-group-card';
import { useSuggestedGroups } from '../hub/suggested-groups/use-suggested-groups';
import { useForeverEventViewerAllowed } from './dungeon-quests.register';

/** "From 2 tanks, 3 healers and 9 DPS (4 unclaimed). Left out: 1 with no role, 2 with no level." */
export function poolFootnote(pool: SuggestedGroupsPoolDto): string {
    const base = `From ${pool.tank} tank${pool.tank === 1 ? '' : 's'}, ${pool.healer} healer${pool.healer === 1 ? '' : 's'} and ${pool.dps} DPS (${pool.unclaimed} unclaimed).`;
    const left = [
        pool.skippedNoRole > 0 ? `${pool.skippedNoRole} with no role` : null,
        pool.skippedNoLevel > 0 ? `${pool.skippedNoLevel} with no level` : null,
    ].filter((s): s is string => s !== null);
    return left.length === 0 ? base : `${base} Left out: ${left.join(', ')}.`;
}

function LoadingRows(): JSX.Element {
    return (
        <div className="flex flex-col gap-2" aria-hidden="true" data-testid="suggested-groups-loading">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />)}
        </div>
    );
}

/** Up to 3 cards; nothing when there are no groups (the probe hides the card too). */
export function SuggestedGroupsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const query = useSuggestedGroups(page.guild.id);
    const canAct = useForeverEventViewerAllowed(page);
    if (query.isError) return <QuietEmpty>Suggested groups are unavailable right now.</QuietEmpty>;
    if (query.data === undefined) return <LoadingRows />;
    const { groups, pool } = query.data;
    if (groups.length === 0) return null;
    return (
        <div aria-busy={query.isFetching}>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                {groups.map((g) => <SuggestedGroupCard key={g.instance.id} group={g} page={page} canAct={canAct} />)}
            </div>
            <CardFootnote testId="suggested-groups-footnote">{poolFootnote(pool)}</CardFootnote>
        </div>
    );
}

export default SuggestedGroupsWidget;
