/**
 * ROK-1745: Quests section on the WoW: Forever character page — summary line,
 * quest log and completed known dungeon quests from the addon snapshot, or the
 * Armory sync's completed list (ROK-2109: an Armory-only character has no log).
 * Renders nothing while loading, on error, or when the API hides it (`quests: null`).
 */
import type { CharacterQuestsDto } from '@raid-ledger/contract';
import { useCharacterQuests } from '../hooks/use-character-quests';
import { formatSourceLine } from '../lib/addon-source-line';
import { plural } from '../lib/plural';
import { CharacterQuestLog } from './character-quest-log';
import { CharacterCompletedQuests } from './character-completed-quests';
import '../slots/quest-prep-panel.css';

/**
 * "2 completed · 377 known · via addon · 1 Oct 2026 · 120 quests total" (R-5);
 * "via Armory · <date>" when the Armory list won (ROK-2109). The date is the
 * winning completed list's `syncedAt` — `inProgressSyncedAt` dates only the log.
 */
function questsSummaryLine(quests: CharacterQuestsDto): string {
    const { completedKnown, knownTotal, completedTotal } = quests.counts;
    return `${completedKnown} completed · ${knownTotal} known · ${formatSourceLine(quests.source, quests.syncedAt)} · ${plural(completedTotal, 'quest')} total`;
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
                <CharacterQuestLog quests={quests.inProgress} />
                <CharacterCompletedQuests groups={quests.completedKnown} knownTotal={quests.counts.knownTotal} />
            </div>
        </div>
    );
}
