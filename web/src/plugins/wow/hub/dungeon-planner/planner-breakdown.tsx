/**
 * ROK-2216 — the planner's LEVELS list and QUEST PREP breakdown (port of the
 * ROK-2207 prototype). The breakdown uses the event page's grouping from the
 * shared `quest-prep-groups.ts` (location → Sharable / Requires quest chain /
 * Must pick up yourself) with a chip per picked claimed character.
 */
import type { JSX } from 'react';
import type { DungeonLevelFit, DungeonPlanDto, EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { StatusChip, type StatusChipTone } from '../../../../components/ui/status-chip';
import { groupByType, splitByLocation } from '../../slots/quest-prep-groups';
import { levelFitCopy } from '../../utils/level-fit';
import { stateOf, type PlanSignup } from './planner-display';
import { QuestRow } from './planner-quest-row';

const FIT_TONE: Readonly<Record<DungeonLevelFit, StatusChipTone>> = { in: 'success', below: 'warning', above: 'neutral', unknown: 'neutral' };

const SECTION_HEADING = 'text-xs font-semibold uppercase tracking-wide text-muted';

/** One line per picked claimed character: name, class + level, the level-fit chip (OQ9: above is neutral). */
export function LevelsList({ plan }: { plan: Pick<DungeonPlanDto, 'characters' | 'instance'> }): JSX.Element {
    const { minimumLevel: min, maximumLevel: max } = plan.instance;
    return (
        <section aria-labelledby="planner-levels" className="space-y-1">
            <h3 id="planner-levels" className={SECTION_HEADING}>Levels</h3>
            {plan.characters.length === 0 && <p className="text-sm text-muted">No characters with quest data yet — add up to 5 from the roster.</p>}
            <ul className="space-y-1">
                {plan.characters.map((c) => (
                    <li key={c.characterId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-[4.5rem] font-medium text-foreground">{c.name}</span>
                        <span className="text-secondary">{c.class ?? ''} {c.level ?? '?'}</span>
                        <StatusChip tone={FIT_TONE[c.levelFit]} title={`${c.name}: ${levelFitCopy(c.levelFit, min, max)}`}>
                            {levelFitCopy(c.levelFit, min, max)}
                        </StatusChip>
                    </li>
                ))}
            </ul>
        </section>
    );
}

interface GroupProps { quests: EnrichedDungeonQuestDto[]; signups: PlanSignup[] }

function SubGroup({ label, icon, quests, signups }: GroupProps & { label: string; icon: string }): JSX.Element | null {
    if (quests.length === 0) return null;
    return (
        <div className="ml-2 space-y-1.5">
            <p className="text-xs font-semibold text-secondary"><span aria-hidden="true">{icon}</span> {label} ({quests.length})</p>
            <ul className="space-y-1.5">{quests.map((q) => <QuestRow key={q.questId} quest={q} signups={signups} />)}</ul>
        </div>
    );
}

function LocationGroup({ title, hint, icon, quests, signups }: GroupProps & { title: string; hint?: string; icon: string }): JSX.Element | null {
    if (quests.length === 0) return null;
    const { sharable, chain, solo } = groupByType(quests);
    return (
        <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground"><span aria-hidden="true">{icon}</span> {title} ({quests.length})</p>
            {hint && <p className="text-xs text-muted">{hint}</p>}
            <SubGroup label="Sharable" icon="🔗" quests={sharable} signups={signups} />
            <SubGroup label="Requires quest chain" icon="⛓" quests={chain} signups={signups} />
            <SubGroup label="Must pick up yourself" icon="👤" quests={solo} signups={signups} />
        </div>
    );
}

/** "7 quests · 3 shareable to grab · 2 chains incomplete". */
function summary({ quests, signups }: GroupProps): string {
    const grab = quests.filter((q) => q.sharable && signups.some((s) => stateOf(s, q.questId)?.state === 'have')).length;
    const chains = quests.filter((q) => q.prevQuestId && signups.some((s) => stateOf(s, q.questId)?.prereqsMet === false)).length;
    return `${quests.length} quests · ${grab} shareable to grab · ${chains} chains incomplete`;
}

/** QUEST PREP: the event page's location + pickup grouping with a chip per character; `note` = the faction line. */
export function QuestBreakdown({ quests, signups, note }: GroupProps & { note: string | null }): JSX.Element {
    const noteLine = note && <p className="text-xs text-dim" data-testid="planner-faction-note">{note}</p>;
    if (quests.length === 0) {
        return (
            <section aria-labelledby="planner-quests" className="space-y-1">
                <h3 id="planner-quests" className={SECTION_HEADING}>Quest prep</h3>
                <p className="text-sm text-muted">No quests for this dungeon.</p>
                {noteLine}
            </section>
        );
    }
    const { before, inside } = splitByLocation(quests);
    return (
        <section aria-labelledby="planner-quests" className="space-y-3">
            <h3 id="planner-quests" className={SECTION_HEADING}>Quest prep · {summary({ quests, signups })}</h3>
            {noteLine}
            <LocationGroup title="Get before you go in" icon="🗺️" quests={before} signups={signups} />
            <LocationGroup title="Picked up inside" hint="Get these during the run" icon="🏰" quests={inside} signups={signups} />
        </section>
    );
}
