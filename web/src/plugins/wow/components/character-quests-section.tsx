/**
 * ROK-1745: Quests section on the WoW: Forever character page — summary line,
 * quest log and completed known dungeon quests from the addon snapshot, or the
 * Armory sync's completed list (ROK-2109: an Armory-only character has no log).
 * Renders nothing while loading, on error, or when the API hides it (`quests: null`).
 * ROK-1927: the own "Attunements" checklists follow, only when the api sent them.
 */
import type { CharacterQuestsDto } from '@raid-ledger/contract';
import { useCharacterQuests } from '../hooks/use-character-quests';
import { useHashScrollIntoView } from '../../../hooks/use-hash-scroll-into-view';
import { formatAsOfSourceLine, formatCaptureDate, formatSourceLine } from '../lib/addon-source-line';
import { plural } from '../lib/plural';
import { CharacterQuestLog } from './character-quest-log';
import { CharacterCompletedQuests } from './character-completed-quests';
import { CharacterAttunements } from './character-attunements';
import '../slots/quest-prep-panel.css';

/**
 * "2 completed · 377 known · via addon · 1 Oct 2026 · 120 quests total" (R-5);
 * "via Armory · <date>" when the Armory list won (ROK-2109). The date is the
 * winning completed list's `syncedAt` — `inProgressSyncedAt` dates only the log.
 * ROK-2145: with no completed quests (a log-only export and no Armory sync, or a
 * synced list that is genuinely empty — the API cannot tell them apart) the line
 * says none are recorded yet instead of "0 completed … 0 quests total".
 * ROK-2144: "· log <date>" follows the source when the log is from another day.
 */
function questsSummaryLine(quests: CharacterQuestsDto): string {
    const { completedKnown, knownTotal, completedTotal } = quests.counts;
    const dated = `${formatSourceLine(quests.source, quests.syncedAt)}${logDateSuffix(quests)}`;
    if (completedTotal === 0) return `No completed quests recorded yet · ${dated}`;
    return `${completedKnown} completed · ${knownTotal} known · ${dated} · ${plural(completedTotal, 'quest')} total`;
}

/** ROK-2144: " · log 9 Nov 2026" when the quest log was captured on another day than the completed list. */
function logDateSuffix(quests: CharacterQuestsDto): string {
    const logDate = formatCaptureDate(quests.inProgressSyncedAt);
    if (!logDate || logDate === formatCaptureDate(quests.syncedAt)) return '';
    return ` · log ${logDate}`;
}

interface SectionProps {
    characterId: string;
    variant: string | null;
    /** ROK-1927: the character's level for the attunement below-level note. */
    level?: number | null;
}

/** The `#quests` anchor: the Attunements detail links members to `/characters/:id#quests` (ROK-1927). */
export const QUESTS_SECTION_ID = 'quests';

/** The Quests card; chrome matches the Talents section. */
export function CharacterQuestsSection({ characterId, variant, level = null }: SectionProps) {
    const { quests, isError } = useCharacterQuests(characterId, variant);
    // The section loads behind a query, so scroll once it has rendered.
    useHashScrollIntoView(QUESTS_SECTION_ID, Boolean(quests) && !isError);
    if (isError || !quests) return null;
    return (
        <div id={QUESTS_SECTION_ID} className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quests</h2>
            <p className="-mt-3 mb-4 text-xs text-muted">{questsSummaryLine(quests)}</p>
            <div className="space-y-6">
                <CharacterQuestLog quests={quests.inProgress} />
                <CharacterCompletedQuests groups={quests.completedKnown} knownTotal={quests.counts.knownTotal} />
                {quests.attunements !== undefined && (
                    <CharacterAttunements attunements={quests.attunements} level={level}
                        sourceLine={formatAsOfSourceLine(quests.source, quests.syncedAt)} />
                )}
            </div>
        </div>
    );
}
