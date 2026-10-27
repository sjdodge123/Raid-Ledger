/**
 * ROK-1924 — the quests × signups readiness views for one event: a matrix on
 * wide screens, a compact per-signup list on phone. Chips reuse `StatusChip`
 * (tokens only); an unmet prerequisite adds a "!" marker with its own label.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { getWowheadQuestUrl } from '../lib/wowhead-urls';
import { cellTitle, QUEST_STATE_META } from './dungeon-quests.helpers';

type Quest = EventQuestReadinessDto['quests'][number];
type Signup = EventQuestReadinessDto['signups'][number];

/** Props shared by both readiness views. */
export interface ReadinessViewProps {
    quests: Quest[];
    signups: Signup[];
    /** Accessible name of the table / list. */
    label: string;
}

const FOREVER_VARIANT = 'wow_forever';

function QuestLink({ quest }: { quest: Quest }): JSX.Element {
    return (
        <a href={getWowheadQuestUrl(quest.questId, FOREVER_VARIANT)} target="_blank" rel="noopener noreferrer"
            className="text-foreground hover:underline">{quest.title}</a>
    );
}

function SignupName({ signup }: { signup: Signup }): JSX.Element {
    if (!signup.characterId) return <span className="text-foreground">{signup.name}</span>;
    return <Link to={`/characters/${signup.characterId}`} className="text-foreground hover:underline">{signup.name}</Link>;
}

function ReadinessChip({ signup, quest }: { signup: Signup; quest: Quest }): JSX.Element {
    const cell = signup.perQuest.find((p) => p.questId === quest.questId);
    const state = cell?.state ?? 'unknown';
    const meta = QUEST_STATE_META[state];
    return (
        <span className="inline-flex items-center gap-1">
            <StatusChip tone={meta.tone} title={cellTitle(signup.name, quest.title, state)}>{meta.label}</StatusChip>
            {cell?.prereqsMet === false && (
                <span role="img" aria-label="Prerequisites not met" title="Prerequisites not met"
                    className="text-xs font-bold text-warning">!</span>
            )}
        </span>
    );
}

/** Quests across, signups down. Scrolls sideways if an event has many quests. */
export function QuestMatrix({ quests, signups, label }: ReadinessViewProps): JSX.Element {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <caption className="sr-only">{label}</caption>
                <thead>
                    <tr>
                        <th scope="col" className="py-1 pr-2 text-left text-xs font-medium text-muted">Signup</th>
                        {quests.map((q) => <th key={q.questId} scope="col" className="px-2 py-1 text-left text-xs font-medium"><QuestLink quest={q} /></th>)}
                    </tr>
                </thead>
                <tbody>
                    {signups.map((s) => (
                        <tr key={s.userId} className="border-t border-edge-subtle">
                            <th scope="row" className="py-1 pr-2 text-left font-medium"><SignupName signup={s} /></th>
                            {quests.map((q) => <td key={q.questId} className="px-2 py-1"><ReadinessChip signup={s} quest={q} /></td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Phone: one card per signup listing each quest with its chip. */
export function QuestCompactList({ quests, signups, label }: ReadinessViewProps): JSX.Element {
    return (
        <ul aria-label={label} className="flex flex-col gap-2">
            {signups.map((s) => (
                <li key={s.userId} className="rounded-lg bg-panel p-2 text-sm">
                    <SignupName signup={s} />
                    <ul className="mt-1 flex flex-col gap-1">
                        {quests.map((q) => (
                            <li key={q.questId} className="flex items-center justify-between gap-2 text-xs">
                                <QuestLink quest={q} />
                                <ReadinessChip signup={s} quest={q} />
                            </li>
                        ))}
                    </ul>
                </li>
            ))}
        </ul>
    );
}
