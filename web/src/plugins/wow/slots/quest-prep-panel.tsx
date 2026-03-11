/**
 * Quest Prep Panel — shows relevant quests when a player is signed up for a dungeon event.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
import { useState, useMemo } from 'react';
import { useAuth } from '../../../hooks/use-auth';
import type { EnrichedDungeonQuestDto, EquipmentItemDto, QuestCoverageEntry } from '@raid-ledger/contract';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { useEnrichedQuests, useQuestCoverage, useUpdateQuestProgress } from '../hooks/use-quest-prep';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { QuestCard } from './quest-card';
import './quest-prep-panel.css';

/**
 * Map game slug to WoW variant for the quest API.
 * Handles both short legacy slugs and full ITAD-style variant slugs.
 * Falls back to classic_era for unknown slugs.
 */
function slugToVariant(gameSlug?: string): string {
    switch (gameSlug) {
        case 'wow-classic-anniversary':
        case 'world-of-warcraft-burning-crusade-classic-anniversary-edition':
            return 'classic_anniversary';
        case 'world-of-warcraft-classic':
        case 'wow-classic-era':
            return 'classic_era';
        case 'wow-classic':
        case 'wow-cata':
        case 'world-of-warcraft-burning-crusade-classic':
        case 'world-of-warcraft-wrath-of-the-lich-king':
            return 'classic';
        case 'wow-retail':
        case 'world-of-warcraft':
            return 'retail';
        default:
            return 'classic_era';
    }
}

/** Check if a quest is usable by a character's class/race */
function isQuestUsable(
    quest: EnrichedDungeonQuestDto,
    charClass: string | null,
    charRace: string | null,
): boolean {
    const classRestrictions = quest.classRestriction as string[] | null;
    const raceRestrictions = quest.raceRestriction as string[] | null;

    const classMatch = !classRestrictions || classRestrictions.length === 0
        || !charClass
        || classRestrictions.some(c => c.toLowerCase() === charClass.toLowerCase());
    const raceMatch = !raceRestrictions || raceRestrictions.length === 0
        || !charRace
        || raceRestrictions.some(r => r.toLowerCase() === charRace.toLowerCase());
    return classMatch && raceMatch;
}

/** Sub-group quests by practical pickup type */
function groupByType(list: EnrichedDungeonQuestDto[]) {
    return {
        sharable: list.filter((q) => q.sharable && !q.prevQuestId),
        chain: list.filter((q) => !!q.prevQuestId),
        solo: list.filter((q) => !q.sharable && !q.prevQuestId),
    };
}

/** Props passed via PluginSlot context from event-detail-page */
interface QuestPrepPanelProps {
    contentInstances: Record<string, unknown>[];
    eventId?: number;
    gameSlug?: string;
    characterId?: string;
}

function useInstanceIds(contentInstances: Record<string, unknown>[]) {
    return useMemo(
        () => contentInstances
            .map((ci) => { const id = ci.id ?? ci.instanceId; return typeof id === 'number' ? id : Number(id); })
            .filter((id) => !isNaN(id) && id > 0),
        [contentInstances],
    );
}

function useEquippedSlotMap(character: ReturnType<typeof useCharacterDetail>['data']) {
    return useMemo(() => {
        const map = new Map<string, EquipmentItemDto>();
        if (character?.equipment?.items) {
            for (const item of character.equipment.items) map.set(item.slot.toUpperCase(), item);
        }
        return map;
    }, [character]);
}

function useCoverageMap(coverage: QuestCoverageEntry[] | undefined) {
    return useMemo(() => {
        const map = new Map<number, QuestCoverageEntry>();
        if (coverage) { for (const entry of coverage) map.set(entry.questId, entry); }
        return map;
    }, [coverage]);
}

function useQuestPrepState(eventId: number | undefined) {
    const [expandedQuests, setExpandedQuests] = useState<Set<number>>(new Set());
    const [pendingQuestId, setPendingQuestId] = useState<number | null>(null);
    const updateProgress = useUpdateQuestProgress(eventId);

    const handleTogglePickedUp = (questId: number, currentlyPickedUp: boolean) => {
        if (eventId) {
            setPendingQuestId(questId);
            updateProgress.mutate({ questId, pickedUp: !currentlyPickedUp }, { onSettled: () => setPendingQuestId(null) });
        }
    };
    const toggleExpanded = (questId: number) => {
        setExpandedQuests((prev) => {
            const next = new Set(prev);
            if (next.has(questId)) next.delete(questId); else next.add(questId);
            return next;
        });
    };
    return { expandedQuests, pendingQuestId, handleTogglePickedUp, toggleExpanded };
}

/** Quest Prep Panel main component */
export function QuestPrepPanel({ contentInstances, eventId, gameSlug, characterId }: QuestPrepPanelProps) {
    const { user } = useAuth();
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);
    const instanceIds = useInstanceIds(contentInstances);
    const { data: quests, isLoading } = useEnrichedQuests(instanceIds, variant);
    const { data: coverage } = useQuestCoverage(eventId);
    const { data: character } = useCharacterDetail(characterId);
    const wowheadVariant = character?.gameVariant ?? variant;
    const equippedBySlot = useEquippedSlotMap(character);
    const coverageMap = useCoverageMap(coverage);
    const { expandedQuests, pendingQuestId, handleTogglePickedUp, toggleExpanded } = useQuestPrepState(eventId);
    useWowheadTooltips(quests ? [quests, character] : []);

    if (!contentInstances.length || instanceIds.length === 0) return null;
    if (isLoading) return <div className="quest-prep-panel"><div className="quest-prep-loading"><span>Loading quest data…</span></div></div>;
    if (!quests || quests.length === 0) return null;

    const charClass = character?.class ?? null;
    const usableQuests = quests.filter((q) => isQuestUsable(q, charClass, character?.race ?? null));
    if (usableQuests.length === 0 && quests.length > 0) return <QuestPrepEmpty />;

    const sharedProps = { coverageMap, currentUserId: user?.id, eventId, wowheadVariant, expandedQuests, pendingQuestId, equippedBySlot, charClass, characterId, onToggleExpanded: toggleExpanded, onTogglePickedUp: handleTogglePickedUp };
    return (
        <div className="quest-prep-panel">
            <QuestPrepHeader count={usableQuests.length} />
            <QuestGroup title="Pick up before you go" icon="🗺️" quests={usableQuests.filter((q) => !q.startsInsideDungeon)} {...sharedProps} />
            <QuestGroup title="Starts inside the dungeon" icon="🏰" quests={usableQuests.filter((q) => q.startsInsideDungeon)} {...sharedProps} />
        </div>
    );
}

function QuestPrepHeader({ count }: { count: number }) {
    return (
        <div className="quest-prep-panel__header">
            <h2 className="quest-prep-panel__title">
                <span className="quest-prep-panel__title-icon">📋</span>
                Quest Prep
            </h2>
            <span className="text-xs text-muted">{count} quests</span>
        </div>
    );
}

/** Empty state when all quests are filtered out */
function QuestPrepEmpty() {
    return (
        <div className="quest-prep-panel">
            <div className="quest-prep-panel__header">
                <h2 className="quest-prep-panel__title">
                    <span className="quest-prep-panel__title-icon">📋</span>
                    Quest Prep
                </h2>
            </div>
            <div className="quest-prep-empty">
                <p>No quests match your character's class and race.</p>
            </div>
        </div>
    );
}

/** Shared props for quest group/subgroup rendering */
interface QuestGroupProps {
    title: string;
    icon: string;
    quests: EnrichedDungeonQuestDto[];
    coverageMap: Map<number, QuestCoverageEntry>;
    currentUserId: number | undefined;
    eventId: number | undefined;
    wowheadVariant: string;
    expandedQuests: Set<number>;
    pendingQuestId: number | null;
    equippedBySlot: Map<string, EquipmentItemDto>;
    charClass: string | null;
    characterId: string | undefined;
    onToggleExpanded: (questId: number) => void;
    onTogglePickedUp: (questId: number, currentlyPickedUp: boolean) => void;
}

/** Render a group of quests (outside/inside) with sub-groups */
function QuestGroup({ title, icon, quests, ...rest }: QuestGroupProps) {
    if (quests.length === 0) return null;
    const { sharable, chain, solo } = groupByType(quests);
    return (
        <div className="quest-group">
            <div className="quest-group__title">
                <span className="quest-group__icon">{icon}</span>
                <span>{title} ({quests.length})</span>
            </div>
            <QuestSubGroup label="Sharable" icon="🔗" quests={sharable} {...rest} />
            <QuestSubGroup label="Requires quest chain" icon="⛓" quests={chain} {...rest} />
            <QuestSubGroup label="Must pick up yourself" icon="👤" quests={solo} {...rest} />
        </div>
    );
}

/** Render a sub-group of quests */
function QuestSubGroup({ label, icon, quests, ...cardProps }: {
    label: string; icon: string; quests: EnrichedDungeonQuestDto[];
} & Omit<QuestGroupProps, 'title' | 'icon' | 'quests'>) {
    if (quests.length === 0) return null;
    return (
        <div className="quest-subgroup">
            <div className="quest-subgroup__label">
                <span>{icon}</span>
                <span>{label} ({quests.length})</span>
            </div>
            {quests.map((quest) => (
                <QuestCard
                    key={quest.questId}
                    quest={quest}
                    questCoverage={cardProps.coverageMap.get(quest.questId)}
                    currentUserId={cardProps.currentUserId}
                    eventId={cardProps.eventId}
                    wowheadVariant={cardProps.wowheadVariant}
                    isExpanded={cardProps.expandedQuests.has(quest.questId)}
                    pendingQuestId={cardProps.pendingQuestId}
                    equippedBySlot={cardProps.equippedBySlot}
                    charClass={cardProps.charClass}
                    characterId={cardProps.characterId}
                    onToggleExpanded={cardProps.onToggleExpanded}
                    onTogglePickedUp={cardProps.onTogglePickedUp}
                />
            ))}
        </div>
    );
}
