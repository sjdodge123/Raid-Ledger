import { useState, useMemo } from 'react';
import { useAuth } from '../../../hooks/use-auth';
import type {
    EnrichedDungeonQuestDto,
    EquipmentItemDto,
    QuestCoverageEntry,
} from '@raid-ledger/contract';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { useEnrichedQuests, useQuestCoverage, useUpdateQuestProgress } from '../hooks/use-quest-prep';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { ItemComparison } from '../components/item-comparison';
import { WowItemCard } from '../components/wow-item-card';
import './quest-prep-panel.css';

/** Quality class mapping */


/** Map Wowhead reward slot names to character equipment slot names */
const REWARD_TO_EQUIP_SLOT: Record<string, string> = {
    HEAD: 'HEAD',
    NECK: 'NECK',
    SHOULDER: 'SHOULDER',
    BACK: 'BACK',
    CHEST: 'CHEST',
    WRIST: 'WRIST',
    HANDS: 'HANDS',
    WAIST: 'WAIST',
    LEGS: 'LEGS',
    FEET: 'FEET',
    FINGER: 'FINGER_1',
    TRINKET: 'TRINKET_1',
    MAIN_HAND: 'MAIN_HAND',
    ONE_HAND: 'MAIN_HAND',
    TWO_HAND: 'MAIN_HAND',
    OFF_HAND: 'OFF_HAND',
    HELD_IN_OFF_HAND: 'OFF_HAND',
    RANGED: 'RANGED',
    SHIRT: 'SHIRT',
    TABARD: 'TABARD',
};

/**
 * Map game slug to WoW variant for the quest API.
 * Falls back to classic_era for unknown slugs.
 */
function slugToVariant(gameSlug?: string): string {
    switch (gameSlug) {
        case 'wow-classic-anniversary':
            return 'classic_anniversary';
        case 'wow-classic':
        case 'wow-cata':
            return 'classic';
        case 'wow-retail':
            return 'retail';
        case 'wow-classic-era':
        default:
            return 'classic_era';
    }
}

import { getWowheadQuestUrl, getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';


/** Format copper amount into WoW gold/silver/copper display */
function formatGold(copper: number): string {
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRem = copper % 100;
    const parts: string[] = [];
    if (gold > 0) parts.push(`${gold}g`);
    if (silver > 0) parts.push(`${silver}s`);
    if (copperRem > 0 || parts.length === 0) parts.push(`${copperRem}c`);
    return parts.join(' ');
}

/**
 * Props passed via PluginSlot context from event-detail-page.
 * contentInstances is a loosely-typed JSON array from the event record.
 */
interface QuestPrepPanelProps {
    contentInstances: Record<string, unknown>[];
    eventId?: number;
    gameSlug?: string;
    characterId?: string;
}

/**
 * Quest Prep Panel — shows relevant quests when a player is signed up for a dungeon event.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
export function QuestPrepPanel({
    contentInstances,
    eventId,
    gameSlug,
    characterId,
}: QuestPrepPanelProps) {
    const { user } = useAuth();
    const currentUserId = user?.id;
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);

    // Extract Blizzard instance IDs from the loosely-typed contentInstances array
    const instanceIds = useMemo(
        () => contentInstances
            .map((ci) => {
                const id = ci.id ?? ci.instanceId;
                return typeof id === 'number' ? id : Number(id);
            })
            .filter((id) => !isNaN(id) && id > 0),
        [contentInstances],
    );

    const { data: quests, isLoading } = useEnrichedQuests(instanceIds, variant);
    const { data: coverage } = useQuestCoverage(eventId);
    const updateProgress = useUpdateQuestProgress(eventId);
    const { data: character } = useCharacterDetail(characterId);

    // Use character's actual gameVariant for Wowhead URLs (more accurate than slug-derived)
    const wowheadVariant = character?.gameVariant ?? variant;


    const [expandedQuests, setExpandedQuests] = useState<Set<number>>(new Set());
    const [pendingQuestId, setPendingQuestId] = useState<number | null>(null);

    // Build slot-to-equipped-item map from character equipment
    const equippedBySlot = useMemo(() => {
        const map = new Map<string, EquipmentItemDto>();
        if (character?.equipment?.items) {
            for (const item of character.equipment.items) {
                map.set(item.slot.toUpperCase(), item);
            }
        }
        return map;
    }, [character]);

    // Refresh Wowhead tooltips when quest data or character equipment changes
    useWowheadTooltips(quests ? [quests, character] : []);

    // Build coverage lookup
    const coverageMap = useMemo(() => {
        const map = new Map<number, QuestCoverageEntry>();
        if (coverage) {
            for (const entry of coverage) {
                map.set(entry.questId, entry);
            }
        }
        return map;
    }, [coverage]);

    // Don't render if no content instances
    if (!contentInstances.length || instanceIds.length === 0) return null;

    if (isLoading) {
        return (
            <div className="quest-prep-panel">
                <div className="quest-prep-loading">
                    <span>Loading quest data…</span>
                </div>
            </div>
        );
    }

    if (!quests || quests.length === 0) return null;

    const charClass = character?.class ?? null;

    // Check if a quest is usable by the signed-up character
    const isQuestUsable = (quest: EnrichedDungeonQuestDto): boolean => {
        const charRace = character?.race ?? null;
        const classRestrictions = quest.classRestriction as string[] | null;
        const raceRestrictions = quest.raceRestriction as string[] | null;

        const classMatch = !classRestrictions || classRestrictions.length === 0
            || !charClass
            || classRestrictions.some(c => c.toLowerCase() === charClass.toLowerCase());
        const raceMatch = !raceRestrictions || raceRestrictions.length === 0
            || !charRace
            || raceRestrictions.some(r => r.toLowerCase() === charRace.toLowerCase());
        return classMatch && raceMatch;
    };

    // Filter to only quests usable by the character's race/class
    const usableQuests = quests.filter(isQuestUsable);

    // Group quests: outside vs inside dungeon
    const outsideQuests = usableQuests.filter((q) => !q.startsInsideDungeon);
    const insideQuests = usableQuests.filter((q) => q.startsInsideDungeon);

    // Sub-group by practical pickup type
    const groupByType = (list: EnrichedDungeonQuestDto[]) => ({
        sharable: list.filter((q) => q.sharable && !q.prevQuestId),
        chain: list.filter((q) => !!q.prevQuestId),
        solo: list.filter((q) => !q.sharable && !q.prevQuestId),
    });


    const handleTogglePickedUp = (questId: number, currentlyPickedUp: boolean) => {
        if (eventId) {
            setPendingQuestId(questId);
            updateProgress.mutate(
                { questId, pickedUp: !currentlyPickedUp },
                { onSettled: () => setPendingQuestId(null) },
            );
        }
    };


    const toggleExpanded = (questId: number) => {
        setExpandedQuests((prev) => {
            const next = new Set(prev);
            if (next.has(questId)) {
                next.delete(questId);
            } else {
                next.add(questId);
            }
            return next;
        });
    };

    const renderQuestCard = (quest: EnrichedDungeonQuestDto) => {
        const questCoverage = coverageMap.get(quest.questId);
        const isCovered = questCoverage && questCoverage.coveredBy.length > 0;
        const wowheadSuffix = getWowheadDataSuffix(wowheadVariant);
        const isExpanded = expandedQuests.has(quest.questId);
        const hasPrereqs = !!quest.prevQuestId;

        // Pre-compute coverage for inline indicator + expanded details
        const coveredByMe = questCoverage?.coveredBy.some(
            (c: { userId: number }) => c.userId === currentUserId
        ) ?? false;
        const coveredByOthers = questCoverage?.coveredBy.filter(
            (c: { userId: number }) => c.userId !== currentUserId
        ) ?? [];

        return (
            <div key={quest.questId} className="quest-card-row">
                {/* Coverage indicator — outside card, to the left (not for chain quests) */}
                {quest.sharable && !hasPrereqs && (
                    coveredByMe ? (
                        <button
                            className="quest-coverage__btn quest-coverage__btn--checked"
                            onClick={() => handleTogglePickedUp(quest.questId, true)}
                            disabled={pendingQuestId === quest.questId}
                            title="Remove — I don't have this quest"
                        >
                            {pendingQuestId === quest.questId ? '…' : '✓'}
                        </button>
                    ) : isCovered ? (
                        <span className="quest-card__inline-status quest-card__inline-status--covered">✓</span>
                    ) : eventId ? (
                        <button
                            className="quest-coverage__btn quest-coverage__btn--add"
                            onClick={() => handleTogglePickedUp(quest.questId, false)}
                            disabled={pendingQuestId === quest.questId}
                            title="I have this quest"
                        >
                            {pendingQuestId === quest.questId ? '…' : '⚠'}
                        </button>
                    ) : (
                        <span className="quest-card__inline-status quest-card__inline-status--needed">&#x26A0;</span>
                    )
                )}

                <div className="quest-card">
                    {/* Single-line header — matches boss-row compactness */}
                    <div className="quest-card__header-wrapper">
                        <div className="quest-card__header" onClick={() => toggleExpanded(quest.questId)} role="button" tabIndex={0}>
                            <span className={`quest-card__chevron ${isExpanded ? 'quest-card__chevron--open' : ''}`}>&#x25B8;</span>
                            <div className="quest-card__info">
                                <span className="quest-card__name">
                                    {quest.name}
                                    {quest.questLevel && (
                                        <span className="quest-card__level"> (Lv{quest.questLevel})</span>
                                    )}
                                </span>
                                {hasPrereqs && (
                                    <span className="quest-card__prereq-badge" title={`Requires ${quest.prerequisiteChain!.length - 1} prerequisite quest(s)`}>
                                        Chain
                                    </span>
                                )}
                            </div>
                        </div>
                        <a
                            className="quest-card__wowhead-icon"
                            href={getWowheadQuestUrl(quest.questId, wowheadVariant)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on Wowhead"
                        >
                            &#x2197;
                        </a>
                    </div>

                    {/* Collapsible body — all details + rewards */}
                    {isExpanded && (
                        <div className="quest-card__body">
                            {/* Quest giver — prominent */}
                            {quest.questGiverNpc && (
                                <div className="quest-card__quest-giver">
                                    Start: {quest.questGiverNpc}
                                    {quest.questGiverZone && (
                                        <span className="quest-card__quest-giver-zone"> &mdash; {quest.questGiverZone}</span>
                                    )}
                                </div>
                            )}

                            {/* Quest metadata: required level, sharable */}
                            <div className="quest-card__meta">
                                {quest.requiredLevel && (
                                    <span className="quest-card__meta-item">Requires Lv{quest.requiredLevel}</span>
                                )}
                                {quest.sharable && (
                                    <span className="quest-card__meta-item quest-card__meta-item--sharable">Sharable</span>
                                )}
                            </div>

                            {/* Restrictions + coverage */}
                            <div className="quest-card__details">
                                <div className="quest-card__details-left">
                                    {quest.raceRestriction && quest.raceRestriction.length > 0 && (
                                        <span className="quest-badge-restriction quest-badge-race">
                                            {(quest.raceRestriction as string[]).join(', ')}
                                        </span>
                                    )}
                                    {quest.classRestriction && quest.classRestriction.length > 0 && (
                                        <span className="quest-badge-restriction quest-badge-class">
                                            {(quest.classRestriction as string[]).join(', ')}
                                        </span>
                                    )}
                                </div>
                                {quest.sharable && !hasPrereqs && (
                                    <div className={`quest-card__details-right ${isCovered ? 'quest-coverage--covered' : 'quest-coverage--uncovered'}`}>
                                        {coveredByMe ? (
                                            <>
                                                <span className="quest-coverage__status">&#x2713; You have this quest</span>
                                                {coveredByOthers.length > 0 && (
                                                    <span className="quest-coverage__also">
                                                        also: {coveredByOthers.map((c: { username: string }) => c.username).join(', ')}
                                                    </span>
                                                )}
                                            </>
                                        ) : isCovered ? (
                                            <span className="quest-coverage__status">
                                                &#x2713; Covered by {questCoverage!.coveredBy.map((c: { username: string }) => c.username).join(', ')}
                                            </span>
                                        ) : (
                                            <span className="quest-coverage__status quest-coverage__status--needed">
                                                No one has this yet
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Gold/XP rewards */}
                            {(quest.rewardGold || quest.rewardXp || (quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1)) && (
                                <div className="quest-reward-meta">
                                    {quest.rewardGold && quest.rewardGold > 0 && (
                                        <span className="quest-reward-gold">&#x1FA99; {formatGold(quest.rewardGold)}</span>
                                    )}
                                    {quest.rewardXp && quest.rewardXp > 0 && (
                                        <span className="quest-reward-xp">&#x2B50; {quest.rewardXp.toLocaleString()} XP</span>
                                    )}
                                    {quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1 && (
                                        <span className="quest-reward-choice">Choose one reward</span>
                                    )}
                                </div>
                            )}

                            {/* Prerequisite chain */}
                            {hasPrereqs && (
                                <div className="quest-prereq">
                                    <span className="text-xs">Requires:</span>
                                    {quest.prerequisiteChain!.map((step: { questId: number; name: string }, idx: number) => (
                                        <span key={step.questId}>
                                            {idx > 0 && <span className="quest-prereq__arrow"> &rarr; </span>}
                                            <span
                                                className={
                                                    step.questId === quest.questId
                                                        ? 'quest-prereq__step--current'
                                                        : 'quest-prereq__step'
                                                }
                                            >
                                                {step.name}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Rewards */}
                            {quest.rewards && quest.rewards.length > 0 && (
                                <div className="quest-rewards">
                                    {quest.rewards.map((reward: { itemId: number; itemName: string; quality: string; slot: string | null; itemLevel: number | null; iconUrl: string | null; itemSubclass: string | null }) => {
                                        const equipSlot = reward.slot ? REWARD_TO_EQUIP_SLOT[reward.slot] ?? reward.slot : null;
                                        const equippedItem = equipSlot
                                            ? equippedBySlot.get(equipSlot)
                                            : undefined;

                                        return (
                                            <div key={reward.itemId} className="quest-reward-item-wrapper">
                                                <WowItemCard
                                                    itemId={reward.itemId}
                                                    name={reward.itemName}
                                                    quality={reward.quality}
                                                    slot={reward.slot}
                                                    itemLevel={reward.itemLevel}
                                                    iconUrl={reward.iconUrl}
                                                    wowheadUrl={getWowheadItemUrl(reward.itemId, wowheadVariant)}
                                                    wowheadData={`item=${reward.itemId}&${wowheadSuffix}`}
                                                />
                                                {equipSlot && characterId && (
                                                    <ItemComparison
                                                        rewardItemLevel={reward.itemLevel}
                                                        equippedItem={equippedItem}
                                                        gameVariant={wowheadVariant}
                                                        characterClass={charClass}
                                                        lootItemSubclass={reward.itemSubclass}
                                                        lootSlot={reward.slot}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderSubGroup = (
        label: string,
        quests: EnrichedDungeonQuestDto[],
        icon: string,
    ) => {
        if (quests.length === 0) return null;
        return (
            <div className="quest-subgroup">
                <div className="quest-subgroup__label">
                    <span>{icon}</span>
                    <span>{label} ({quests.length})</span>
                </div>
                {quests.map(renderQuestCard)}
            </div>
        );
    };

    const renderGroup = (
        title: string,
        icon: string,
        quests: EnrichedDungeonQuestDto[],
    ) => {
        if (quests.length === 0) return null;
        const { sharable, chain, solo } = groupByType(quests);

        return (
            <div className="quest-group">
                <div className="quest-group__title">
                    <span className="quest-group__icon">{icon}</span>
                    <span>{title} ({quests.length})</span>
                </div>
                {renderSubGroup('Sharable', sharable, '🔗')}
                {renderSubGroup('Requires quest chain', chain, '⛓')}
                {renderSubGroup('Must pick up yourself', solo, '👤')}
            </div>
        );
    };

    return (
        <div className="quest-prep-panel">
            <div className="quest-prep-panel__header">
                <h2 className="quest-prep-panel__title">
                    <span className="quest-prep-panel__title-icon">📋</span>
                    Quest Prep
                </h2>
                <span className="text-xs text-muted">
                    {usableQuests.length} quests
                </span>
            </div>

            {renderGroup('Pick up before you go', '🗺️', outsideQuests)}
            {renderGroup('Starts inside the dungeon', '🏰', insideQuests)}
        </div>
    );
}
