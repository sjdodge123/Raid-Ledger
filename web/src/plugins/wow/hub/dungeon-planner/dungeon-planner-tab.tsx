/**
 * ROK-2216 — the Dungeon planner hub tab on WoW: Forever guild hubs (the
 * approved ROK-2207 prototype, wired to real data): one Forever dungeon, up to
 * five roster characters, their level fit and the dungeon's quests in the event
 * page's grouping — plus Copy link, Wowhead and Create event. Two columns at
 * ≥1024px (§4.18), stacked below with the Create-event set in a sticky bar.
 */
import { useMemo, type JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { DungeonPlanDto, EnrichedDungeonQuestDto, WowInstanceDto } from '@raid-ledger/contract';
import type { HubCtx } from '../../../hub-module';
import { useMediaQuery } from '../../../../hooks/use-media-query';
import { useRosterInsights } from '../../hub-widgets/use-roster-insights';
import { useEnrichedQuests } from '../../hooks/use-quest-prep';
import { useWowInstances } from '../../hooks/use-wow-instances';
import { GroupChips } from './character-picker';
import { LevelsList } from './planner-breakdown';
import { CopyLinkButton, CreateEventButtons, type CreateEventLinks } from './planner-controls';
import { DungeonSection, FactionPill, QuestSection } from './planner-sections';
import { createEventUrl, shareUrl } from './planner-url';
import { usePlannerState, type PlannerState } from './use-planner-state';
import { useDungeonPlan } from './use-dungeon-plan';

const VARIANT = 'wow_forever';

/** The Create-event links for the current plan (N = characters the API kept, spec L12). */
function eventLinks(page: HubCtx['page'], s: PlannerState, plan: DungeonPlanDto | undefined, dropped: ReadonlySet<string>): CreateEventLinks {
    const base = { gameId: page.guild.gameId, guildId: page.guild.id, instanceIds: s.instanceId === null ? [] : [s.instanceId] };
    const inviteCharacterIds = plan?.characters.map((c) => c.characterId) ?? [];
    return {
        plain: s.instanceId === null ? null : createEventUrl(base),
        invite: createEventUrl({ ...base, inviteCharacterIds }),
        inviteCount: inviteCharacterIds.length,
        excluded: s.picks.filter((p) => !p.claimed || dropped.has(p.key)).map((p) => p.name),
    };
}

/** Pick keys the plan marks below range, and the claimed ids it dropped as stale. */
function planMarks(plan: DungeonPlanDto | undefined): { below: Set<string>; dropped: Set<string> } {
    const below = (plan?.characters ?? []).filter((c) => c.levelFit === 'below').map((c) => c.characterId.toLowerCase());
    return { below: new Set(below), dropped: new Set((plan?.droppedCharacterIds ?? []).map((id) => id.toLowerCase())) };
}

interface ColumnsProps {
    s: PlannerState;
    instances: WowInstanceDto[];
    plan: UseQueryResult<DungeonPlanDto, Error>;
    marks: { below: Set<string>; dropped: Set<string> };
    desktop: boolean;
    enriched: EnrichedDungeonQuestDto[] | undefined;
}

/** Controls + levels on the left, quest prep on the right at ≥1024px; stacked below. */
function PlannerColumns({ s, instances, plan, marks, desktop, enriched }: ColumnsProps): JSX.Element {
    return (
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-6 lg:space-y-0">
            <div className="space-y-4">
                <DungeonSection instances={instances} selected={instances.find((i) => i.id === s.instanceId)}
                    onSelect={s.setInstanceId} desktop={desktop} />
                <GroupChips s={s} belowRange={marks.below} dropped={marks.dropped} />
                {plan.data && <div className="border-t border-edge-subtle pt-3"><LevelsList plan={plan.data} /></div>}
            </div>
            <div className="border-t border-edge-subtle pt-3 lg:border-t-0 lg:pt-0">
                <QuestSection instanceId={s.instanceId} plan={plan} enriched={enriched} />
            </div>
        </div>
    );
}

/** The tab body (default export: `dungeonPlannerTab` lazy-loads it). */
export default function DungeonPlannerTab({ page }: Pick<HubCtx, 'page'>): JSX.Element {
    const desktop = useMediaQuery('(min-width: 1024px)');
    const s = usePlannerState(useRosterInsights(page.guild.id).data);
    const instances = useWowInstances(VARIANT, 'dungeon').data?.data ?? [];
    const plan = useDungeonPlan(page.guild.id, s.instanceId, s.characterIds);
    const enriched = useEnrichedQuests(s.instanceId === null ? [] : [s.instanceId], VARIANT);
    const marks = useMemo(() => planMarks(plan.data), [plan.data]);
    const links = eventLinks(page, s, plan.data, marks.dropped);
    const share = shareUrl(window.location.origin, page.guild.id, { instanceId: s.instanceId, tokens: s.picks.map((p) => p.token) });
    const actions = <CreateEventButtons links={links} />;
    return (
        <div className="rounded-lg border border-edge bg-surface p-4" data-testid="dungeon-planner">
            <div className={`space-y-4 ${desktop ? '' : 'pb-6'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-foreground">Dungeon planner</h2>
                        <FactionPill plan={plan.data} />
                    </div>
                    <div className="flex flex-wrap items-start gap-2"><CopyLinkButton url={share} />{desktop && actions}</div>
                </div>
                <PlannerColumns s={s} instances={instances} plan={plan} marks={marks} desktop={desktop}
                    enriched={s.instanceId === null ? undefined : enriched.data?.get(s.instanceId)} />
            </div>
            {!desktop && <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-edge bg-surface p-3">{actions}</div>}
        </div>
    );
}
