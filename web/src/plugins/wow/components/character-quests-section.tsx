/**
 * ROK-1745: Quests section on the WoW: Forever character page — summary line,
 * quest log and completed known dungeon quests from the addon snapshot.
 * Renders nothing while loading, on error, or when the API hides it (`quests: null`).
 */
import type { CharacterQuestsDto } from '@raid-ledger/contract';
import { useCharacterQuests } from '../hooks/use-character-quests';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import { CharacterQuestLog } from './character-quest-log';
import { CharacterCompletedQuests } from './character-completed-quests';
import '../slots/quest-prep-panel.css';

/** "2 completed · 377 known · via addon · 1 Oct 2026 · 120 quests total" (R-5). */
function questsSummaryLine(quests: CharacterQuestsDto): string {
    const { completedKnown, knownTotal, completedTotal } = quests.counts;
    return `${completedKnown} completed · ${knownTotal} known · ${formatAddonSourceLine(quests.syncedAt)} · ${completedTotal} quests total`;
}

/** Instance names known from the completed groups, used to tag log quests. */
function instanceNameMap(quests: CharacterQuestsDto): Map<number, string> {
    return new Map(quests.completedKnown.map((g) => [g.dungeonInstanceId, g.instanceName]));
}

/** The Quests card; chrome matches the Talents section. */
export function CharacterQuestsSection({ characterId, variant }: { characterId: string; variant: string | null }) {
    const { quests, isError } = useCharacterQuests(characterId, variant);
    if (isError || !quests) return null;
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quests</h2>
            <p className="-mt-3 mb-4 text-xs text-muted">{questsSummaryLine(quests)}</p>
            <div className="space-y-6">
                <CharacterQuestLog quests={quests.inProgress} instanceNames={instanceNameMap(quests)} />
                <CharacterCompletedQuests groups={quests.completedKnown} knownTotal={quests.counts.knownTotal} />
            </div>
        </div>
    );
}
