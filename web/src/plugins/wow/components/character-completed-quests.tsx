/**
 * ROK-1745: "Completed dungeon quests" — one collapsed `ScrollCollapsible`
 * per instance (R-7), each row with its quest chain when it has >1 step.
 */
import { Fragment } from 'react';
import type { CharacterCompletedQuest, CharacterQuestInstanceGroup } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { getWowheadQuestUrl } from '../lib/wowhead-urls';

/** Chain line: each step success (done) or warning (still needed). */
function QuestChain({ chain }: { chain: CharacterCompletedQuest['chain'] }) {
    if (chain.length <= 1) return null;
    return (
        <div className="quest-prereq">
            {chain.map((step, i) => (
                <Fragment key={step.questId}>
                    {i > 0 && <span className="quest-prereq__arrow" aria-hidden="true">→</span>}
                    <span className={`quest-prereq__step ${step.done ? 'text-success' : 'text-warning'}`}>{step.name}</span>
                </Fragment>
            ))}
        </div>
    );
}

/** One completed quest: name, (LvN), Wowhead link, chain. */
function CompletedRow({ quest }: { quest: CharacterCompletedQuest }) {
    return (
        <li className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2">
                <span className="quest-card__name break-words">{quest.name}</span>
                {quest.questLevel !== null && <span className="quest-card__level text-sm">(Lv{quest.questLevel})</span>}
                <a className="quest-card__wowhead-icon" href={getWowheadQuestUrl(quest.questId, 'wow_forever')}
                    target="_blank" rel="noopener noreferrer" aria-label={`${quest.name} on Wowhead`}>↗</a>
            </div>
            <QuestChain chain={quest.chain} />
        </li>
    );
}

/** Completed known dungeon quests grouped by instance; "0 of M known" when none overlap. */
export function CharacterCompletedQuests({ groups, knownTotal }: {
    groups: CharacterQuestInstanceGroup[]; knownTotal: number;
}) {
    return (
        <div>
            <h3 className="text-sm font-medium text-foreground mb-2">Completed dungeon quests</h3>
            {groups.length === 0 ? (
                <p className="text-sm text-muted">0 of {knownTotal} known dungeon quests</p>
            ) : (
                <div className="space-y-2">
                    {groups.map((g) => (
                        <ScrollCollapsible key={g.dungeonInstanceId} defaultOpen={false}
                            title={`${g.instanceName} · ${g.completed.length}/${g.knownCount}`}>
                            <ul className="space-y-2">
                                {g.completed.map((q) => <CompletedRow key={q.questId} quest={q} />)}
                            </ul>
                        </ScrollCollapsible>
                    ))}
                </div>
            )}
        </div>
    );
}
