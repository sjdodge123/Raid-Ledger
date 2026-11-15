/**
 * ROK-2207 prototype — the planner's LEVELS list and QUEST PREP breakdown.
 * The breakdown uses the event page's grouping (location → Sharable / Requires
 * quest chain / Must pick up yourself) with one chip per picked character —
 * the spec's new "per-quest character chip row" pattern.
 */
import type { JSX } from 'react';
import type { EnrichedDungeonQuestDto, EventQuestReadinessDto, WowInstanceDto } from '@raid-ledger/contract';
import { StatusChip, type StatusChipTone } from '../../components/ui/status-chip';
import { cellTitle, QUEST_STATE_META } from '../../plugins/wow/hub-widgets/dungeon-quests.helpers';
import { getWowheadQuestUrl } from '../../plugins/wow/lib/wowhead-urls';
import { groupByType, levelFit, levelFitCopy, type LevelFit, type PlannerCharacter } from './planner-helpers';

type Signup = EventQuestReadinessDto['signups'][number];

const FIT_TONE: Record<LevelFit, StatusChipTone> = { in: 'success', below: 'warning', above: 'neutral', unknown: 'neutral' };

/** One line per picked character: name, class + level, and the level-fit chip (OQ9: "above" is neutral). */
export function LevelsList({ chars, instance }: { chars: PlannerCharacter[]; instance: WowInstanceDto }): JSX.Element {
    return (
        <section aria-labelledby="planner-levels" className="space-y-1">
            <h3 id="planner-levels" className="text-xs font-semibold uppercase tracking-wide text-muted">Levels</h3>
            <ul className="space-y-1">
                {chars.map((c) => {
                    const fit = levelFit(c.level, instance);
                    return (
                        <li key={c.name} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="min-w-[4.5rem] font-medium text-foreground">{c.name}</span>
                            <span className="text-secondary">{c.className} {c.level}</span>
                            <StatusChip tone={FIT_TONE[fit]} title={`${c.name}: ${levelFitCopy(fit, instance)}`}>
                                {levelFitCopy(fit, instance)}
                            </StatusChip>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function stateOf(s: Signup, questId: number): Signup['perQuest'][number] | undefined {
    return s.perQuest.find((p) => p.questId === questId);
}

/** The chip row: every picked character's state for one quest, "!" when prerequisites are unmet. */
function CharacterChips({ quest, signups }: { quest: EnrichedDungeonQuestDto; signups: Signup[] }): JSX.Element {
    return (
        <div className="flex flex-wrap gap-1.5">
            {signups.map((s) => {
                const cell = stateOf(s, quest.questId);
                const state = cell?.state ?? 'unknown';
                const meta = QUEST_STATE_META[state];
                return (
                    <span key={s.name} className="inline-flex items-center gap-1 text-xs">
                        <span className={s.characterId ? 'text-secondary' : 'text-dim'}>{s.name}</span>
                        <StatusChip tone={meta.tone} title={cellTitle(s.name, quest.name, state)}>{meta.label}</StatusChip>
                        {cell?.prereqsMet === false && (
                            <span role="img" aria-label="Prerequisites not met" title="Prerequisites not met"
                                className="font-bold text-warning">!</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

/** "Aelin can share it" / "! Brann: prerequisites not met" under the chip row. */
function QuestNotes({ quest, signups }: { quest: EnrichedDungeonQuestDto; signups: Signup[] }): JSX.Element | null {
    const sharers = quest.sharable ? signups.filter((s) => stateOf(s, quest.questId)?.state === 'have').map((s) => s.name) : [];
    const blocked = signups.filter((s) => stateOf(s, quest.questId)?.prereqsMet === false).map((s) => s.name);
    if (sharers.length === 0 && blocked.length === 0) return null;
    return (
        <div className="mt-1 space-y-0.5 text-xs">
            {sharers.length > 0 && <p className="text-success">→ {sharers.join(', ')} can share it</p>}
            {blocked.length > 0 && <p className="text-warning">! {blocked.join(', ')}: prerequisites not met</p>}
        </div>
    );
}

function QuestRow({ quest, signups }: { quest: EnrichedDungeonQuestDto; signups: Signup[] }): JSX.Element {
    return (
        <li className="rounded-md border border-edge-subtle bg-panel px-3 py-2">
            <div className="flex flex-col gap-1.5">
                <a href={getWowheadQuestUrl(quest.questId, 'wow_forever')} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-foreground hover:underline">{quest.name} ↗</a>
                <CharacterChips quest={quest} signups={signups} />
            </div>
            <QuestNotes quest={quest} signups={signups} />
        </li>
    );
}

function SubGroup({ label, icon, quests, signups }: { label: string; icon: string; quests: EnrichedDungeonQuestDto[]; signups: Signup[] }): JSX.Element | null {
    if (quests.length === 0) return null;
    return (
        <div className="ml-2 space-y-1.5">
            <p className="text-xs font-semibold text-secondary"><span aria-hidden="true">{icon}</span> {label} ({quests.length})</p>
            <ul className="space-y-1.5">{quests.map((q) => <QuestRow key={q.questId} quest={q} signups={signups} />)}</ul>
        </div>
    );
}

function LocationGroup({ title, hint, icon, quests, signups }: {
    title: string; hint?: string; icon: string; quests: EnrichedDungeonQuestDto[]; signups: Signup[];
}): JSX.Element | null {
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

/** The summary line: "7 quests · 3 shareable to grab · 2 chains incomplete". */
function summary(quests: EnrichedDungeonQuestDto[], signups: Signup[]): string {
    const grab = quests.filter((q) => q.sharable && signups.some((s) => stateOf(s, q.questId)?.state === 'have')).length;
    const chains = quests.filter((q) => q.prevQuestId && signups.some((s) => stateOf(s, q.questId)?.prereqsMet === false)).length;
    return `${quests.length} quests · ${grab} shareable to grab · ${chains} chains incomplete`;
}

/** QUEST PREP: the event page's location + pickup grouping with a chip per character. */
export function QuestBreakdown({ quests, signups }: { quests: EnrichedDungeonQuestDto[]; signups: Signup[] }): JSX.Element {
    return (
        <section aria-labelledby="planner-quests" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="planner-quests" className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Quest prep · {summary(quests, signups)}
                </h3>
                <span className="text-xs text-dim">as of 2h ago</span>
            </div>
            <LocationGroup title="Get before you go in" icon="🗺️" quests={quests.filter((q) => !q.startsInsideDungeon)} signups={signups} />
            <LocationGroup title="Picked up inside" hint="Get these during the run" icon="🏰"
                quests={quests.filter((q) => q.startsInsideDungeon)} signups={signups} />
        </section>
    );
}
