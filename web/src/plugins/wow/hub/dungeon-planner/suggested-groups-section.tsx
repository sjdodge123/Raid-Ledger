/**
 * ROK-2212 — "Suggested groups" inside the Dungeon planner tab (ruling 7: not
 * a new hub tab): every ranked group of five (scope `all`, ≤10 per dungeon),
 * a dungeon filter (`Select`), §4.5 empty, §4.6 skeleton. "Open in planner"
 * loads the group into the planner above in place; Poll opens the hub-tagged
 * scheduling poll. Schedule + Poll only for viewers who can act (ruling 6).
 */
import { useState, type JSX } from 'react';
import type { GuildPage, SuggestedGroupDto } from '@raid-ledger/contract';
import { QuietEmpty } from '../../../../components/hub/card-bits';
import { Select } from '../../../../components/ui/select';
import { useForeverEventViewerAllowed } from '../../hub-widgets/dungeon-quests.register';
import { SuggestedGroupCard } from '../suggested-groups/suggested-group-card';
import { SuggestedGroupPollModal } from '../suggested-groups/suggested-group-poll';
import { useGroupPoll } from '../suggested-groups/use-group-poll';
import { useSuggestedGroups } from '../suggested-groups/use-suggested-groups';
import { dungeonOptions, groupKey, groupOrdinals, visibleGroups, type DungeonOption } from './suggested-groups-section.helpers';

const FILTER_ID = 'suggested-groups-dungeon';

function LoadingRows(): JSX.Element {
    return (
        <div className="flex flex-col gap-2" aria-hidden="true" data-testid="suggested-groups-section-loading">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />)}
        </div>
    );
}

function DungeonFilter({ options, value, onChange }: { options: DungeonOption[]; value: number | null; onChange: (id: number | null) => void }): JSX.Element {
    return (
        <div className="flex w-full items-center gap-2 sm:w-auto">
            <label htmlFor={FILTER_ID} className="shrink-0 text-sm text-muted">Show groups for</label>
            <Select id={FILTER_ID} fieldSize="sm" wrapperClassName="w-full sm:w-56" className="min-h-11"
                value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">All dungeons</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
        </div>
    );
}

/** Error, loading (§4.6) or empty (§4.5) — nothing once there are groups to show. */
function SectionState({ isError, loaded, empty }: { isError: boolean; loaded: boolean; empty: boolean }): JSX.Element | null {
    if (isError) return <QuietEmpty>Suggested groups are unavailable right now.</QuietEmpty>;
    if (!loaded) return <LoadingRows />;
    if (!empty) return null;
    return (
        <QuietEmpty testId="suggested-groups-section-empty">
            No group of five fits yet — a group needs a tank, a healer and three DPS inside a dungeon&apos;s level range.
        </QuietEmpty>
    );
}

interface SectionProps {
    page: GuildPage;
    /** Load a group into the planner (dungeon + its five picks). */
    onOpenInPlanner: (group: SuggestedGroupDto) => void;
}

/** The section body under the planner. */
export function SuggestedGroupsSection({ page, onOpenInPlanner }: SectionProps): JSX.Element {
    const [instanceId, setInstanceId] = useState<number | null>(null);
    const query = useSuggestedGroups(page.guild.id, 'all');
    const canAct = useForeverEventViewerAllowed(page);
    const poll = useGroupPoll(canAct);
    const groups = query.data?.groups ?? [];
    const shown = visibleGroups(groups, instanceId);
    const ordinals = groupOrdinals(shown);
    return (
        <section aria-labelledby="suggested-groups-heading" className="space-y-3 border-t border-edge-subtle pt-4" data-testid="suggested-groups-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="suggested-groups-heading" className="text-base font-semibold text-foreground">Suggested groups</h3>
                {groups.length > 0 && <DungeonFilter options={dungeonOptions(groups)} value={instanceId} onChange={setInstanceId} />}
            </div>
            <SectionState isError={query.isError} loaded={query.data !== undefined} empty={shown.length === 0} />
            {shown.length > 0 && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy={query.isFetching}>
                    {shown.map((g) => (
                        <SuggestedGroupCard key={groupKey(g)} group={g} page={page} canAct={canAct} ordinal={ordinals.get(groupKey(g))}
                            onPoll={poll.onPoll} onOpenInPlanner={onOpenInPlanner} />
                    ))}
                </div>
            )}
            {poll.group && <SuggestedGroupPollModal group={poll.group} page={page} onClose={poll.close} />}
        </section>
    );
}
