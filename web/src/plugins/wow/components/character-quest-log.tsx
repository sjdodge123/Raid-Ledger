/**
 * ROK-1745: "In progress (k)" — the character's quest log with per-objective
 * done/open state. Reuses the event quest-card CSS classes (D9), not its components.
 */
import type { CharacterQuestLogEntry, CharacterQuestObjective } from '@raid-ledger/contract';
import { getWowheadQuestUrl } from '../lib/wowhead-urls';

/** One objective row: success when done (check glyph + sr-only "done"), warning when open. */
function ObjectiveRow({ objective }: { objective: CharacterQuestObjective }) {
    const counter = objective.have !== null && objective.need !== null ? `${objective.have}/${objective.need}` : null;
    return (
        <li className={`flex flex-wrap items-baseline gap-x-1 text-sm ${objective.done ? 'text-success' : 'text-warning'}`}>
            {objective.done && <span aria-hidden="true">✓</span>}
            <span className="break-words">{objective.text}</span>
            {counter && <span className="font-mono">{counter}</span>}
            {objective.done && <span className="sr-only">done</span>}
        </li>
    );
}

/** One quest in the log: title + Wowhead link, optional instance tag, objectives. */
function QuestLogRow({ quest }: { quest: CharacterQuestLogEntry }) {
    const title = quest.title ?? `Quest ${quest.questId}`;
    return (
        <li data-quest-row className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="quest-card__name break-words">{title}</span>
                <a className="quest-card__wowhead-icon" href={getWowheadQuestUrl(quest.questId, 'wow_forever')}
                    target="_blank" rel="noopener noreferrer" aria-label={`${title} on Wowhead`}>↗</a>
                {quest.instanceName && <span className="text-xs text-muted">{quest.instanceName}</span>}
            </div>
            {quest.objectives.length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-3">
                    {quest.objectives.map((o, i) => <ObjectiveRow key={i} objective={o} />)}
                </ul>
            )}
        </li>
    );
}

/** The in-progress quest list; "No quests in progress" when the log is empty. */
export function CharacterQuestLog({ quests }: { quests: CharacterQuestLogEntry[] }) {
    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-2">In progress ({quests.length})</h3>
            {quests.length === 0 ? (
                <p className="text-sm text-muted">No quests in progress</p>
            ) : (
                <ul className="space-y-3">
                    {quests.map((q) => <QuestLogRow key={q.questId} quest={q} />)}
                </ul>
            )}
        </div>
    );
}
