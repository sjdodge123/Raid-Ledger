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
import { isQuestUsable, deduplicateByName } from '../utils/quest-dedup';
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

interface ParsedInstance { id: number; name?: string }

function useParsedInstances(contentInstances: Record<string, unknown>[]): ParsedInstance[] {
    return useMemo(
        () => contentInstances
            .map((ci) => ({
                id: typeof ci.id === 'number' ? ci.id : Number(ci.id ?? ci.instanceId),
                name: typeof ci.name === 'string' ? ci.name : undefined,
            }))
            .filter((inst) => !isNaN(inst.id) && inst.id > 0),
        [contentInstances],
    );
}

function useInstanceIds(instances: ParsedInstance[]) {
    return useMemo(() => instances.map((inst) => inst.id), [instances]);
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

/** Flatten a questsByInstance map into a single array */
function flattenQuestMap(questMap: Map<number, EnrichedDungeonQuestDto[]> | undefined): EnrichedDungeonQuestDto[] {
    if (!questMap) return [];
    const seen = new Set<number>();
    const result: EnrichedDungeonQuestDto[] = [];
    for (const batch of questMap.values()) {
        for (const q of batch) {
            if (!seen.has(q.questId)) { seen.add(q.questId); result.push(q); }
        }
    }
    return result;
}

/** Filter and deduplicate quests for a character */
function filterUsableQuests(quests: EnrichedDungeonQuestDto[], character: ReturnType<typeof useCharacterDetail>['data']) {
    if (quests.length === 0) return [];
    const charClass = character?.class ?? null;
    const charRace = character?.race ?? null;
    return deduplicateByName(quests.filter((q) => isQuestUsable(q, charClass, charRace)), charClass, charRace);
}

function useAllUsableQuests(questMap: Map<number, EnrichedDungeonQuestDto[]> | undefined, character: ReturnType<typeof useCharacterDetail>['data']) {
    return useMemo(() => filterUsableQuests(flattenQuestMap(questMap), character), [questMap, character]);
}

/** Assemble shared props from all the individual hooks */
function buildSharedProps(user: ReturnType<typeof useAuth>['user'], coverageMap: Map<number, QuestCoverageEntry>, eventId: number | undefined, wowheadVariant: string, expandedQuests: Set<number>, pendingQuestId: number | null, equippedBySlot: Map<string, EquipmentItemDto>, character: ReturnType<typeof useCharacterDetail>['data'], characterId: string | undefined, toggleExpanded: (id: number) => void, handleTogglePickedUp: (id: number, v: boolean) => void): SharedQuestProps {
    return { coverageMap, currentUserId: user?.id, eventId, wowheadVariant, expandedQuests, pendingQuestId, equippedBySlot, charClass: character?.class ?? null, characterId, onToggleExpanded: toggleExpanded, onTogglePickedUp: handleTogglePickedUp };
}

/** Quest Prep Panel main component */
export function QuestPrepPanel({ contentInstances, eventId, gameSlug, characterId }: QuestPrepPanelProps) {
    const { user } = useAuth();
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);
    const parsedInstances = useParsedInstances(contentInstances);
    const instanceIds = useInstanceIds(parsedInstances);
    const { data: questMap, isLoading } = useEnrichedQuests(instanceIds, variant);
    const { data: coverage } = useQuestCoverage(eventId);
    const { data: character } = useCharacterDetail(characterId);
    const wowheadVariant = character?.gameVariant ?? variant;
    const equippedBySlot = useEquippedSlotMap(character);
    const coverageMap = useCoverageMap(coverage);
    const allUsable = useAllUsableQuests(questMap, character);
    const allFlat = useMemo(() => flattenQuestMap(questMap), [questMap]);
    const { expandedQuests, pendingQuestId, handleTogglePickedUp, toggleExpanded } = useQuestPrepState(eventId);
    useWowheadTooltips(questMap ? [allFlat, character] : []);

    if (!contentInstances.length || instanceIds.length === 0) return null;
    if (isLoading) return <div className="quest-prep-panel"><div className="quest-prep-loading"><span>Loading quest data…</span></div></div>;
    if (!questMap || allFlat.length === 0) return null;
    if (allUsable.length === 0 && allFlat.length > 0) return <QuestPrepEmpty />;

    const shared = buildSharedProps(user, coverageMap, eventId, wowheadVariant, expandedQuests, pendingQuestId, equippedBySlot, character, characterId, toggleExpanded, handleTogglePickedUp);
    return <QuestPrepBody instances={parsedInstances} questMap={questMap} allUsable={allUsable} character={character} shared={shared} />;
}

/** Render the panel body — separated to keep main component under 30 lines */
function QuestPrepBody({ instances, questMap, allUsable, character, shared }: {
    instances: ParsedInstance[]; questMap: Map<number, EnrichedDungeonQuestDto[]>;
    allUsable: EnrichedDungeonQuestDto[]; character: ReturnType<typeof useCharacterDetail>['data']; shared: SharedQuestProps;
}) {
    return (
        <div className="quest-prep-panel">
            <QuestPrepHeader count={allUsable.length} />
            {instances.length > 1
                ? instances.map((inst) => (
                    <InstanceQuestSection key={inst.id} instance={inst} quests={questMap.get(inst.id) ?? []} character={character} {...shared} />
                ))
                : <QuestLocationGroups quests={allUsable} {...shared} />
            }
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

/** Shared props for quest rendering (passed through from panel) */
interface SharedQuestProps {
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

/** Render outside/inside location groups for a list of quests */
function QuestLocationGroups({ quests, ...rest }: { quests: EnrichedDungeonQuestDto[] } & SharedQuestProps) {
    return (
        <>
            <QuestGroup title="Pick up before you go" icon="&#x1F5FA;&#xFE0F;" quests={quests.filter((q) => !q.startsInsideDungeon)} {...rest} />
            <QuestGroup title="Starts inside the dungeon" icon="&#x1F3F0;" quests={quests.filter((q) => q.startsInsideDungeon)} {...rest} />
        </>
    );
}

/** Render a dungeon instance section with header + location-grouped quests (multi-dungeon) */
function InstanceQuestSection({ instance, quests, character, ...rest }: {
    instance: ParsedInstance; quests: EnrichedDungeonQuestDto[];
    character: ReturnType<typeof useCharacterDetail>['data'];
} & SharedQuestProps) {
    const usable = filterUsableQuests(quests, character);
    if (usable.length === 0) return null;
    return (
        <div className="quest-prep-instance">
            {instance.name && <h3 className="boss-loot-instance__name">{instance.name}</h3>}
            <QuestLocationGroups quests={usable} {...rest} />
        </div>
    );
}

/** Props for a single quest group (outside/inside) with sub-groups */
interface QuestGroupProps extends SharedQuestProps {
    title: string;
    icon: string;
    quests: EnrichedDungeonQuestDto[];
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
