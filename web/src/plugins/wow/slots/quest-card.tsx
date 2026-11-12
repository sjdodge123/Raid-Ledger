/**
 * Quest card component for the Quest Prep Panel.
 * Renders a single quest with collapsible details.
 */
import type { EnrichedDungeonQuestDto, QuestCoverageEntry, EquipmentItemDto, QuestPrereqState } from '@raid-ledger/contract';
import { getWowheadQuestUrl, getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import { ItemCompareRow } from '../components/item-compare-row';
import { questRewardAsLoot } from '../lib/quest-reward-loot';
import { formatGold, formatReputationReward, prerequisiteCount } from './quest-card-constants';
import { QuestPrereqChain } from './quest-prereq-chain';
import { asDatedSource, formatSourceLine, type DatedSource } from '../lib/addon-source-line';

/**
 * The viewer's chain state for this quest (ROK-1748, ROK-2109); the capture date
 * now sits once under the Quest Prep header (ROK-2144).
 */
export interface QuestCardPrereqs { state: QuestPrereqState }

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
    prereqs?: QuestCardPrereqs | undefined;
}

function useQuestCardState(questCoverage: QuestCoverageEntry | undefined, currentUserId: number | undefined) {
    const isCovered = questCoverage && questCoverage.coveredBy.length > 0;
    const coveredByMe = questCoverage?.coveredBy.some((c: { userId: number }) => c.userId === currentUserId) ?? false;
    const coveredByOthers = questCoverage?.coveredBy.filter((c: { userId: number }) => c.userId !== currentUserId) ?? [];
    return { isCovered: !!isCovered, coveredByMe, coveredByOthers };
}

/** Render a single quest card with coverage indicator */
export function QuestCard({
    quest, questCoverage, currentUserId, eventId,
    wowheadVariant, isExpanded, pendingQuestId,
    equippedBySlot, charClass, characterId,
    onToggleExpanded, onTogglePickedUp, prereqs,
}: QuestCardProps) {
    const { isCovered, coveredByMe, coveredByOthers } = useQuestCardState(questCoverage, currentUserId);
    // A quest with any prevQuestId is not shareable; the Chain badge and line need a resolved prerequisite (ROK-2143).
    const hasPrevQuest = !!quest.prevQuestId;
    const prereqTotal = prerequisiteCount(quest);

    return (
        <div key={quest.questId} className="quest-card-row">
            {quest.sharable && !hasPrevQuest && (
                <CoverageIndicator questId={quest.questId} coveredByMe={coveredByMe} isCovered={isCovered}
                    eventId={eventId} pendingQuestId={pendingQuestId} onToggle={onTogglePickedUp} />
            )}
            <div className="quest-card">
                <QuestCardHeader quest={quest} isExpanded={isExpanded} prereqTotal={prereqTotal}
                    completed={prereqs?.state.completed ?? false}
                    wowheadVariant={wowheadVariant} onToggle={() => onToggleExpanded(quest.questId)} />
                {isExpanded && (
                    <QuestCardBody quest={quest} hasPrevQuest={hasPrevQuest} prereqTotal={prereqTotal} coveredByMe={coveredByMe}
                        coveredByOthers={coveredByOthers} isCovered={isCovered} questCoverage={questCoverage}
                        wowheadSuffix={getWowheadDataSuffix(wowheadVariant)} wowheadVariant={wowheadVariant}
                        equippedBySlot={equippedBySlot} charClass={charClass} characterId={characterId} prereqs={prereqs} />
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

function QuestCardHeader({ quest, isExpanded, prereqTotal, completed, wowheadVariant, onToggle }: {
    quest: EnrichedDungeonQuestDto; isExpanded: boolean; prereqTotal: number;
    completed: boolean; wowheadVariant: string; onToggle: () => void;
}) {
    return (
        <div className="quest-card__header-wrapper">
            <div className="quest-card__header" onClick={onToggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
                role="button" tabIndex={0}>
                <span className={`quest-card__chevron ${isExpanded ? 'quest-card__chevron--open' : ''}`}>&#x25B8;</span>
                <div className="quest-card__info">
                    <span className="quest-card__name">
                        {quest.name}
                        {quest.questLevel && <span className="quest-card__level"> (Lv{quest.questLevel})</span>}
                    </span>
                    {prereqTotal > 0 && (
                        <span className="quest-card__prereq-badge" title={`Requires ${prereqTotal} prerequisite quest(s)`}>Chain</span>
                    )}
                    {completed && <DonePill />}
                </div>
            </div>
            <a className="quest-card__wowhead-icon" href={getWowheadQuestUrl(quest.questId, wowheadVariant)}
                target="_blank" rel="noopener noreferrer" title="View on Wowhead" aria-label="View on Wowhead">&#x2197;</a>
        </div>
    );
}

/** "Done" pill — the viewer has completed this quest (ROK-1748). */
function DonePill() {
    return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-success/30 bg-success/10 px-1.5 text-[0.625rem] font-semibold text-success">
            Done
        </span>
    );
}

function QuestCardBody({ quest, hasPrevQuest, prereqTotal, coveredByMe, coveredByOthers, isCovered, questCoverage, wowheadSuffix, wowheadVariant, equippedBySlot, charClass, characterId, prereqs }: {
    quest: EnrichedDungeonQuestDto; hasPrevQuest: boolean; prereqTotal: number; coveredByMe: boolean;
    coveredByOthers: { userId: number; username: string }[];
    isCovered: boolean; questCoverage: QuestCoverageEntry | undefined;
    wowheadSuffix: string; wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    charClass: string | null; characterId: string | undefined;
    prereqs: QuestCardPrereqs | undefined;
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
            <QuestRestrictions quest={quest} hasPrereqs={hasPrevQuest} coveredByMe={coveredByMe}
                coveredByOthers={coveredByOthers} isCovered={isCovered} questCoverage={questCoverage} />
            <QuestRewardsMeta quest={quest} />
            <QuestPrereqSection quest={quest} hasPrevQuest={hasPrevQuest} prereqTotal={prereqTotal} prereqs={prereqs} />
            <QuestRewardItems quest={quest} wowheadSuffix={wowheadSuffix} wowheadVariant={wowheadVariant}
                equippedBySlot={equippedBySlot} charClass={charClass} characterId={characterId} />
        </div>
    );
}

/** The chain line, or a muted note when the prerequisite is not in our data (ROK-2143). */
function QuestPrereqSection({ quest, hasPrevQuest, prereqTotal, prereqs }: {
    quest: EnrichedDungeonQuestDto; hasPrevQuest: boolean; prereqTotal: number; prereqs: QuestCardPrereqs | undefined;
}) {
    if (prereqTotal > 0) return <QuestPrereqChain quest={quest} state={prereqs?.state} />;
    if (!hasPrevQuest) return null;
    return <p className="text-xs text-muted" data-testid="quest-prereq-missing">Prerequisite not in data</p>;
}

function QuestCoverageStatus({ coveredByMe, coveredByOthers, isCovered, questCoverage }: {
    coveredByMe: boolean; coveredByOthers: { userId: number; username: string }[];
    isCovered: boolean; questCoverage: QuestCoverageEntry | undefined;
}) {
    if (coveredByMe) {
        return (
            <>
                <span className="quest-coverage__status">&#x2713; You have this quest</span>
                {coveredByOthers.length > 0 && <span className="quest-coverage__also">also: {coveredByOthers.map((c) => c.username).join(', ')}</span>}
            </>
        );
    }
    if (isCovered) return <span className="quest-coverage__status">&#x2713; Covered by {questCoverage!.coveredBy.map((c: { username: string }) => c.username).join(', ')}</span>;
    return <span className="quest-coverage__status quest-coverage__status--needed">No one has this yet</span>;
}

/**
 * Newest dated coverage entry (addon or Armory), or null when no entry carries a
 * snapshot source (manual / Classic coverage). ROK-2109 adds the Armory.
 */
function latestDatedCoverage(questCoverage: QuestCoverageEntry | undefined): { source: DatedSource; asOf: string } | null {
    let latest: { source: DatedSource; asOf: string } | null = null;
    for (const c of questCoverage?.coveredBy ?? []) {
        const source = asDatedSource(c.source);
        if (!source) continue;
        const asOf = c.asOf ?? '';
        if (!latest || asOf > latest.asOf) latest = { source, asOf };
    }
    return latest;
}

/** "via addon · <date>" / "via Armory · <date>" under the coverage status (ROK-1748 §5, ROK-2109). */
function CoverageSourceLine({ questCoverage }: { questCoverage: QuestCoverageEntry | undefined }) {
    const latest = latestDatedCoverage(questCoverage);
    if (latest === null) return null;
    return (
        <span className="text-xs text-muted" data-testid="quest-coverage-source">
            {formatSourceLine(latest.source, latest.asOf)}
        </span>
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
                    <QuestCoverageStatus coveredByMe={coveredByMe} coveredByOthers={coveredByOthers} isCovered={isCovered} questCoverage={questCoverage} />
                    <CoverageSourceLine questCoverage={questCoverage} />
                </div>
            )}
        </div>
    );
}

function QuestRewardsMeta({ quest }: { quest: EnrichedDungeonQuestDto }) {
    const reputation = quest.reputationRewards ?? [];
    if (!quest.rewardGold && !quest.rewardXp && reputation.length === 0 && !(quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1)) return null;
    return (
        <div className="quest-reward-meta">
            {quest.rewardGold && quest.rewardGold > 0 && <span className="quest-reward-gold">&#x1FA99; {formatGold(quest.rewardGold)}</span>}
            {quest.rewardXp && quest.rewardXp > 0 && <span className="quest-reward-xp">&#x2B50; {quest.rewardXp.toLocaleString()} XP</span>}
            {reputation.length > 0 && <QuestReputationRewards rewards={reputation} />}
            {quest.rewardType === 'choice' && quest.rewards && quest.rewards.length > 1 && <span className="quest-reward-choice">Choose one reward</span>}
        </div>
    );
}

/** ROK-2161: the ROK-2165 label chip — the `.quest-card` overlay fill is below AA for bare semantic text. */
const REPUTATION_CHIP = 'inline-block max-w-full truncate rounded-sm bg-surface/70 px-1';

/** ROK-2161: one chip per faction — `text-success` for a gain, `text-danger` for a loss. `min-w-0` lets the flex item shrink so a long chip truncates. */
function QuestReputationRewards({ rewards }: { rewards: { factionName: string; amount: number }[] }) {
    return (
        <span className="min-w-0 max-w-full" data-testid="quest-reward-reputation">
            {rewards.map((reward, i) => (
                <span key={`${reward.factionName}-${i}`}>
                    {i > 0 && ', '}
                    <span className={`${REPUTATION_CHIP} ${reward.amount > 0 ? 'text-success' : 'text-danger'}`} data-testid="quest-reward-reputation-entry">
                        {formatReputationReward(reward)}
                    </span>
                </span>
            ))}
        </span>
    );
}

/** ROK-2186: choice + guaranteed rewards render through the boss-loot row (stat chips + compare popup). */
function QuestRewardItems({ quest, wowheadSuffix, wowheadVariant, equippedBySlot, charClass, characterId }: {
    quest: EnrichedDungeonQuestDto; wowheadSuffix: string; wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>; charClass: string | null; characterId: string | undefined;
}) {
    if (!quest.rewards || quest.rewards.length === 0) return null;
    return (
        <div className="quest-rewards">
            {quest.rewards.map((reward) => (
                <ItemCompareRow key={reward.itemId} item={questRewardAsLoot(reward, quest.expansion)}
                    wowheadVariant={wowheadVariant} equippedBySlot={equippedBySlot}
                    characterClass={charClass} hasCharacter={!!characterId}
                    links={{ url: getWowheadItemUrl(reward.itemId, wowheadVariant), data: `item=${reward.itemId}&${wowheadSuffix}` }} />
            ))}
        </div>
    );
}
