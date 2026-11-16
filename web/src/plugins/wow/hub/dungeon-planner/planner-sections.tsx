/**
 * ROK-2216 — the planner tab's sections (port of the ROK-2207 prototype's
 * `PlannerBody` pieces): the guild-faction pill, the dungeon section and the
 * quest section with its loading / error / empty states (§4.5).
 */
import type { JSX } from 'react';
import type { DungeonPlanDto, EnrichedDungeonQuestDto, WowInstanceDto } from '@raid-ledger/contract';
import { DungeonPicker, UnverifiedHint, WowheadLink } from './planner-controls';
import { instanceRange } from './planner-display';
import { QuestBreakdown } from './planner-breakdown';
import { hiddenFactionNote } from './planner-faction';

const FACTION_PILL: Readonly<Record<'alliance' | 'horde', { cls: string; label: string }>> = {
    alliance: { cls: 'border-faction-alliance/30 bg-faction-alliance/10 text-faction-alliance', label: 'Alliance' },
    horde: { cls: 'border-faction-horde/30 bg-faction-horde/10 text-faction-horde', label: 'Horde' },
};

/** "Alliance guild" — shown when the quest list is filtered by the guild's faction. */
export function FactionPill({ plan }: { plan: DungeonPlanDto | undefined }): JSX.Element | null {
    if (!plan?.side || plan.sideSource !== 'guild') return null;
    const { cls, label } = FACTION_PILL[plan.side];
    return <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>{label} guild</span>;
}

interface DungeonSectionProps {
    instances: WowInstanceDto[];
    selected: WowInstanceDto | undefined;
    onSelect: (id: number) => void;
    desktop: boolean;
}

/** "DUNGEON · Deadmines Lv15-21  levels unverified  Wowhead ↗" over the picker. */
export function DungeonSection({ instances, selected, onSelect, desktop }: DungeonSectionProps): JSX.Element {
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Dungeon{selected ? ` · ${selected.name} ${instanceRange(selected)}` : ''}
                </p>
                {selected && <UnverifiedHint instance={selected} />}
                {selected && <WowheadLink instance={selected} />}
            </div>
            <DungeonPicker instances={instances} selectedId={selected?.id ?? null} onSelect={onSelect} desktop={desktop} />
        </div>
    );
}

interface QuestSectionProps {
    instanceId: number | null;
    plan: { data: DungeonPlanDto | undefined; isLoading: boolean; isError: boolean };
    /** The dungeon's enriched quests (grouping metadata); undefined while loading. */
    enriched: EnrichedDungeonQuestDto[] | undefined;
}

/** Only quests the plan API listed (side-filtered, ROK-2214 L11), in the enriched order. */
function planQuests(plan: DungeonPlanDto, enriched: EnrichedDungeonQuestDto[]): EnrichedDungeonQuestDto[] {
    const ids = new Set(plan.readiness.quests.map((q) => q.questId));
    return enriched.filter((q) => ids.has(q.questId));
}

/** QUEST PREP for the picked dungeon, or the state that stands in for it. */
export function QuestSection({ instanceId, plan, enriched }: QuestSectionProps): JSX.Element {
    if (instanceId === null) return <p className="text-sm text-muted">Pick a dungeon to see its quests and who is ready.</p>;
    if (plan.isError) return <p className="text-sm text-danger">Couldn't load this plan. Try another dungeon or reload.</p>;
    if (plan.isLoading || !plan.data || !enriched) return <p className="text-sm text-muted">Loading quests…</p>;
    return (
        <QuestBreakdown quests={planQuests(plan.data, enriched)} signups={plan.data.readiness.signups}
            note={hiddenFactionNote(plan.data)} />
    );
}
