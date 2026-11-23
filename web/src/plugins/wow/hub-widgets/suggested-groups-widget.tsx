/**
 * ROK-2212 — the Forever "Suggested groups" hub widget body: the best group of
 * each of the 3 best dungeons, then a footnote on who the pool held (unclaimed
 * roster rows included) and who it left out. Lazy-loaded by the register file.
 * Poll opens the hub-tagged scheduling poll pre-filled with the group.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { CardFootnote } from '../../../components/hub/card-bits';
import { SuggestedGroupCard } from '../hub/suggested-groups/suggested-group-card';
import { SuggestedGroupPollModal } from '../hub/suggested-groups/suggested-group-poll';
import { useGroupPoll } from '../hub/suggested-groups/use-group-poll';
import { useSuggestedGroups } from '../hub/suggested-groups/use-suggested-groups';
import { useForeverEventViewerAllowed } from './dungeon-quests.register';
import { poolFootnote } from './suggested-groups.helpers';

/**
 * Up to 3 cards. The `useVisible` probe (`suggested-groups.register.ts`) keeps the
 * card unmounted while loading, on error and when empty, so the body renders
 * nothing in those states rather than a skeleton or an error line nobody sees.
 */
export function SuggestedGroupsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const query = useSuggestedGroups(page.guild.id);
    const canAct = useForeverEventViewerAllowed(page);
    const poll = useGroupPoll(canAct);
    if (query.data === undefined) return null;
    const { groups, pool } = query.data;
    if (groups.length === 0) return null;
    return (
        <div aria-busy={query.isFetching}>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                {groups.map((g) => <SuggestedGroupCard key={g.instance.id} group={g} page={page} canAct={canAct} onPoll={poll.onPoll} />)}
            </div>
            <CardFootnote testId="suggested-groups-footnote">{poolFootnote(pool)}</CardFootnote>
            {poll.group && <SuggestedGroupPollModal group={poll.group} page={page} onClose={poll.close} />}
        </div>
    );
}

export default SuggestedGroupsWidget;
