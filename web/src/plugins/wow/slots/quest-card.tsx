/**
 * Quest card component for the Quest Prep Panel.
 * Renders a single quest with collapsible details.
 */
import type { EnrichedDungeonQuestDto, QuestCoverageEntry, EquipmentItemDto } from '@raid-ledger/contract';
import { getWowheadQuestUrl, getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import { ItemComparison } from '../components/item-comparison';
import { WowItemCard } from '../components/wow-item-card';
import { REWARD_TO_EQUIP_SLOT, formatGold } from './quest-card-constants';

interface QuestCardProps {
    quest: EnrichedDungeonQuestDto;
    questCoverage: QuestCoverageEntry | undefined;
    currentUserId: number | undefined;
    eventId: number | undefined;
    wowheadVariant: string;
    isExpanded: boolean;
    pendingQuestId: number | null;
    equippedBySlot: Map<string, EquipmentItemDto>;
    charClass: string | null;
    characterId: string | undefined;
    onToggleExpanded: (questId: number) => void;
    onTogglePickedUp: (questId: number, currentlyPickedUp: boolean) => void;
}

/** Render a single quest card with coverage indicator */
export function QuestCard({
    quest, questCoverage, currentUserId, eventId,
    wowheadVariant, isExpanded, pendingQuestId,
    equippedBySlot, charClass, characterId,
    onToggleExpanded, onTogglePickedUp,
}: QuestCardProps) {
    const isCovered = questCoverage && questCoverage.coveredBy.length > 0;
    const wowheadSuffix = getWowheadDataSuffix(wowheadVariant);
    const hasPrereqs = !!quest.prevQuestId;
    const coveredByMe = questCoverage?.coveredBy.some(
        (c: { userId: number }) => c.userId === currentUserId,
    ) ?? false;
    const coveredByOthers = questCoverage?.coveredBy.filter(
        (c: { userId: number }) => c.userId !== currentUserId,
    ) ?? [];

    return (
        <div key={quest.questId} className="quest-card-row">
            {quest.sharable && !hasPrereqs && (
                <CoverageIndicator
                    questId={quest.questId}
                    coveredByMe={coveredByMe}
                    isCovered={!!isCovered}
                    eventId={eventId}
                    pendingQuestId={pendingQuestId}
                    onToggle={onTogglePickedUp}
                />
            )}

            <div className="quest-card">
                <QuestCardHeader
                    quest={quest}
                    isExpanded={isExpanded}
                    hasPrereqs={hasPrereqs}
                    wowheadVariant={wowheadVariant}
                    onToggle={() => onToggleExpanded(quest.questId)}
                />

                {isExpanded && (
                    <QuestCardBody
                        quest={quest}
                        hasPrereqs={hasPrereqs}
                        coveredByMe={coveredByMe}
                        coveredByOthers={coveredByOthers}
                        isCovered={!!isCovered}
                        questCoverage={questCoverage}
                        wowheadSuffix={wowheadSuffix}
                        wowheadVariant={wowheadVariant}
                        equippedBySlot={equippedBySlot}
                        charClass={charClass}
                        characterId={characterId}
                    />
                )}
            </div>
        </div>
    );
}

function CoverageIndicator({ questId, coveredByMe, isCovered, eventId, pendingQuestId, onToggle }: {
    questId: number; coveredByMe: boolean; isCovered: boolean;
    eventId: number | undefined; pendingQuestId: number | null;
    onToggle: (questId: number, currentlyPickedUp: boolean) => void;
}) {
    if (coveredByMe) {
        return (
            <button className="quest-coverage__btn quest-coverage__btn--checked"
                onClick={() => onToggle(questId, true)}
                disabled={pendingQuestId === questId}
                title="Remove -- I don't have this quest">
                {pendingQuestId === questId ? '...' : '\u2713'}
            </button>
        );
    }
    if (isCovered) {
        return <span className="quest-card__inline-status quest-card__inline-status--covered">{'\u2713'}</span>;
    }
    if (eventId) {
        return (
            <button className="quest-coverage__btn quest-coverage__btn--add"
                onClick={() => onToggle(questId, false)}
                disabled={pendingQuestId === questId}
                title="I have this quest">
                {pendingQuestId === questId ? '...' : '\u26A0'}
            </button>
        );
    }
    return <span className="quest-card__inline-status quest-card__inline-status--needed">&#x26A0;</span>;
}

function QuestCardHeader({ quest, isExpanded, hasPrereqs, wowheadVariant, onToggle }: {
    quest: EnrichedDungeonQuestDto; isExpanded: boolean;
    hasPrereqs: boolean; wowheadVariant: string; onToggle: () => void;
}) {
    return (
        <div className="quest-card__header-wrapper">
            <div className="quest-card__header" onClick={onToggle} role="button" tabIndex={0}>
                <span className={`quest-card__chevron ${isExpanded ? 'quest-card__chevron--open' : ''}`}>&#x25B8;</span>
                <div className="quest-card__info">
                    <span className="quest-card__name">
                        {quest.name}
                        {quest.questLevel && <span className="quest-card__level"> (Lv{quest.questLevel})</span>}
                    </span>
                    {hasPrereqs && (
                        <span className="quest-card__prereq-badge" title={`Requires ${quest.prerequisiteChain!.length - 1} prerequisite quest(s)`}>Chain</span>
                    )}
                </div>
            </div>
            <a className="quest-card__wowhead-icon" href={getWowheadQuestUrl(quest.questId, wowheadVariant)}
                target="_blank" rel="noopener noreferrer" title="View on Wowhead">&#x2197;</a>
        </div>
    );
}

function QuestCardBody({ quest, hasPrereqs, coveredByMe, coveredByOthers, isCovered, questCoverage, wowheadSuffix, wowheadVariant, equippedBySlot, charClass, characterId }: {
    quest: EnrichedDungeonQuestDto; hasPrereqs: boolean; coveredByMe: boolean;
    coveredByOthers: { userId: number; username: string }[];
    isCovered: boolean; questCoverage: QuestCoverageEntry | undefined;
    wowheadSuffix: string; wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    charClass: string | null; characterId: string | undefined;
}) {
    return (
        <div className="quest-card__body">
            {quest.questGiverNpc && (
                <div className="quest-card__quest-giver">
                    Start: {quest.questGiverNpc}
                    {quest.questGiverZone && <span className="quest-card__quest-giver-zone"> &mdash; {quest.questGiverZone}</span>}
                </div>
            )}
            <div className="quest-card__meta">
                {quest.requiredLevel && <span className="quest-card__meta-item">Requires Lv{quest.requiredLevel}</span>}
                {quest.sharable && <span className="quest-card__meta-item quest-card__meta-item--sharable">Sharable</span>}
            </div>
            <QuestRestrictions quest={quest} hasPrereqs={hasPrereqs} coveredByMe={coveredByMe}
                coveredByOthers={coveredByOthers} isCovered={isCovered} questCoverage={questCoverage} />
            <QuestRewardsMeta quest={quest} />
            {hasPrereqs && <QuestPrereqChain quest={quest} />}
            <QuestRewardItems quest={quest} wowheadSuffix={wowheadSuffix} wowheadVariant={wowheadVariant}
                equippedBySlot={equippedBySlot} charClass={charClass} characterId={characterId} />
        </div>
    );
}

function QuestRestrictions({ quest, hasPrereqs, coveredByMe, coveredByOthers, isCovered, questCoverage }: {
    quest: EnrichedDungeonQuestDto; hasPrereqs: boolean; coveredByMe: boolean;
    coveredByOthers: { userId: number; username: string }[];
    isCovered: boolean; questCoverage: QuestCoverageEntry | undefined;
}) {
    return (
        <div className="quest-card__details">
            <div className="quest-card__details-left">
                {quest.raceRestriction && (quest.raceRestriction as string[]).length > 0 && (
                    <span className="quest-badge-restriction quest-badge-race">{(quest.raceRestriction as string[]).join(', ')}</span>
                )}
                {quest.classRestriction && (quest.classRestriction as string[]).length > 0 && (
                    <span className="quest-badge-restriction quest-badge-class">{(quest.classRestriction as string[]).join(', ')}</span>
                )}
            </div>
            {quest.sharable && !hasPrereqs && (
                <div className={`quest-card__details-right ${isCovered ? 'quest-coverage--covered' : 'quest-coverage--uncovered'}`}>
                    {coveredByMe ? (
                        <>
                            <span className="quest-coverage__status">&#x2713; You have this quest</span>
                            {coveredByOthers.length > 0 && (
                                <span className="quest-coverage__also">also: {coveredByOthers.map((c) => c.username).join(', ')}</span>
                            )}
                        </>
                    ) : isCovered ? (
                        <span className="quest-coverage__status">&#x2713; Covered by {questCoverage!.coveredBy.map((c: { username: string }) => c.username).join(', ')}</span>
                    ) : (
                        <span className="quest-coverage__status quest-coverage__status--needed">No one has this yet</span>
                    )}
                </div>
            )}
        </div>
    );
}

function QuestRewardsMeta({ quest }: { quest: EnrichedDungeonQuestDto }) {
    if (!quest.rewardGold && !quest.rewardXp && !(quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1)) return null;
    return (
        <div className="quest-reward-meta">
            {quest.rewardGold && quest.rewardGold > 0 && <span className="quest-reward-gold">&#x1FA99; {formatGold(quest.rewardGold)}</span>}
            {quest.rewardXp && quest.rewardXp > 0 && <span className="quest-reward-xp">&#x2B50; {quest.rewardXp.toLocaleString()} XP</span>}
            {quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1 && <span className="quest-reward-choice">Choose one reward</span>}
        </div>
    );
}

function QuestPrereqChain({ quest }: { quest: EnrichedDungeonQuestDto }) {
    return (
        <div className="quest-prereq">
            <span className="text-xs">Requires:</span>
            {quest.prerequisiteChain!.map((step: { questId: number; name: string }, idx: number) => (
                <span key={step.questId}>
                    {idx > 0 && <span className="quest-prereq__arrow"> &rarr; </span>}
                    <span className={step.questId === quest.questId ? 'quest-prereq__step--current' : 'quest-prereq__step'}>{step.name}</span>
                </span>
            ))}
        </div>
    );
}

function QuestRewardItems({ quest, wowheadSuffix, wowheadVariant, equippedBySlot, charClass, characterId }: {
    quest: EnrichedDungeonQuestDto; wowheadSuffix: string; wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>; charClass: string | null; characterId: string | undefined;
}) {
    if (!quest.rewards || quest.rewards.length === 0) return null;
    return (
        <div className="quest-rewards">
            {quest.rewards.map((reward: { itemId: number; itemName: string; quality: string; slot: string | null; itemLevel: number | null; iconUrl: string | null; itemSubclass: string | null }) => {
                const equipSlot = reward.slot ? REWARD_TO_EQUIP_SLOT[reward.slot] ?? reward.slot : null;
                const equippedItem = equipSlot ? equippedBySlot.get(equipSlot) : undefined;
                return (
                    <div key={reward.itemId} className="quest-reward-item-wrapper">
                        <WowItemCard itemId={reward.itemId} name={reward.itemName} quality={reward.quality}
                            slot={reward.slot} itemLevel={reward.itemLevel} iconUrl={reward.iconUrl}
                            wowheadUrl={getWowheadItemUrl(reward.itemId, wowheadVariant)}
                            wowheadData={`item=${reward.itemId}&${wowheadSuffix}`} />
                        {equipSlot && characterId && (
                            <ItemComparison rewardItemLevel={reward.itemLevel} equippedItem={equippedItem}
                                gameVariant={wowheadVariant} characterClass={charClass}
                                lootItemSubclass={reward.itemSubclass} lootSlot={reward.slot} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
