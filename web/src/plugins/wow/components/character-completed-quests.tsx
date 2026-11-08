/**
 * ROK-1745: "Completed dungeon quests" — one collapsed `ScrollCollapsible`
 * per instance (R-7), each row with its quest chain when it has >1 step.
 * ROK-2146: each group shows its first 5 quests, then "Show all N" / "Show fewer".
 */
import { Fragment, useId } from 'react';
import type { CharacterCompletedQuest, CharacterQuestInstanceGroup } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { getWowheadQuestUrl } from '../lib/wowhead-urls';
import { ShowAllToggle, useRowCap } from './show-all-toggle';

/**
 * Chain line: each step success (done) or warning (still needed), plus sr-only
 * state text. The token colour sits on an inner span because the unlayered
 * `.quest-prereq__step` rule in quest-prep-panel.css beats Tailwind utilities.
 */
function QuestChain({ chain }: { chain: CharacterCompletedQuest['chain'] }) {
    if (chain.length <= 1) return null;
    return (
        <div className="quest-prereq">
            {chain.map((step, i) => (
                <Fragment key={step.questId}>
                    {i > 0 && <span className="quest-prereq__arrow" aria-hidden="true">→</span>}
                    <span className="quest-prereq__step">
                        <span className={step.done ? 'text-success' : 'text-warning'}>{step.name}</span>
                        <span className="sr-only">{step.done ? 'done' : 'not done'}</span>
                    </span>
                </Fragment>
            ))}
        </div>
    );
}

/** One completed quest: name, (LvN), Wowhead link, chain. */
function CompletedRow({ quest }: { quest: CharacterCompletedQuest }) {
    return (
        <li data-completed-quest-row className="min-w-0">
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

/** One instance's collapsed group, capped to the first 5 quests. */
function CompletedGroup({ group }: { group: CharacterQuestInstanceGroup }) {
    const listId = useId();
    const { visible, capped, expanded, toggle } = useRowCap(group.completed);
    return (
        <ScrollCollapsible defaultOpen={false} title={`${group.instanceName} · ${group.completed.length}/${group.knownCount}`}>
            <ul id={listId} className="space-y-2">
                {visible.map((q) => <CompletedRow key={q.questId} quest={q} />)}
            </ul>
            {capped && <ShowAllToggle total={group.completed.length} expanded={expanded} onToggle={toggle} controls={listId} />}
        </ScrollCollapsible>
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
                    {groups.map((g) => <CompletedGroup key={g.dungeonInstanceId} group={g} />)}
                </div>
            )}
        </div>
    );
}
