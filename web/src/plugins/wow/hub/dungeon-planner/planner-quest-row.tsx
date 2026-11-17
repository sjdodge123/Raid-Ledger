/**
 * ROK-2216 — one quest in the planner's breakdown: the Wowhead link and the
 * per-quest character chip row (the spec's new pattern). A quest absent from a
 * character's `perQuest` is "n/a" — that character can't take it — never
 * "missing" (ROK-2214 R6).
 */
import type { JSX } from 'react';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { StatusChip } from '../../../../components/ui/status-chip';
import { cellTitle, QUEST_STATE_META } from '../../hub-widgets/dungeon-quests.helpers';
import { getWowheadQuestUrl } from '../../lib/wowhead-urls';
import { EscortChip } from '../../lib/escort-chip';
import { stateOf, type PlanSignup } from './planner-display';

function CharacterChip({ s, quest }: { s: PlanSignup; quest: EnrichedDungeonQuestDto }): JSX.Element {
    const cell = stateOf(s, quest.questId);
    return (
        <span className="inline-flex items-center gap-1 text-xs" data-testid="planner-quest-chip">
            <span className="text-secondary">{s.name}</span>
            {cell ? (
                <StatusChip tone={QUEST_STATE_META[cell.state].tone} title={cellTitle(s.name, quest.name, cell.state)}>
                    {QUEST_STATE_META[cell.state].label}
                </StatusChip>
            ) : (
                <StatusChip tone="neutral" title={`${s.name} can't take this quest`}>n/a</StatusChip>
            )}
            {cell?.prereqsMet === false && (
                <span role="img" aria-label="Prerequisites not met" title="Prerequisites not met" className="font-bold text-warning">!</span>
            )}
        </span>
    );
}

/** "→ Aelin can share it" / "! Brann: prerequisites not met" under the chip row. */
function QuestNotes({ quest, signups }: { quest: EnrichedDungeonQuestDto; signups: PlanSignup[] }): JSX.Element | null {
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

/** A quest row: name (Wowhead), one chip per picked claimed character, share/prereq notes. */
export function QuestRow({ quest, signups }: { quest: EnrichedDungeonQuestDto; signups: PlanSignup[] }): JSX.Element {
    return (
        <li className="rounded-md border border-edge-subtle bg-panel px-3 py-2" data-testid={`planner-quest-${quest.questId}`}>
            <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <a href={getWowheadQuestUrl(quest.questId, 'wow_forever')} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium text-foreground hover:underline">{quest.name} ↗</a>
                    <EscortChip isEscort={quest.isEscort} />
                </div>
                {signups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {signups.map((s) => <CharacterChip key={s.characterId ?? s.name} s={s} quest={quest} />)}
                    </div>
                )}
            </div>
            <QuestNotes quest={quest} signups={signups} />
        </li>
    );
}
