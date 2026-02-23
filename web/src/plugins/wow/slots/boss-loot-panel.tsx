import { useState, useMemo } from 'react';
import type { BossEncounterDto, BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { useBossesForInstance, useLootForBoss } from '../hooks/use-boss-loot';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { WowItemCard } from '../components/wow-item-card';
import { ItemComparison } from '../components/item-comparison';
import { getWowheadItemUrl, getWowheadDataSuffix, getWowheadNpcSearchUrl } from '../lib/wowhead-urls';
import './boss-loot-panel.css';

/** Map loot slot names to character equipment slot names for upgrade detection */
const LOOT_TO_EQUIP_SLOT: Record<string, string> = {
    'Head': 'HEAD',
    'Neck': 'NECK',
    'Shoulder': 'SHOULDER',
    'Back': 'BACK',
    'Chest': 'CHEST',
    'Wrist': 'WRIST',
    'Hands': 'HANDS',
    'Waist': 'WAIST',
    'Legs': 'LEGS',
    'Feet': 'FEET',
    'Finger': 'FINGER_1',
    'Trinket': 'TRINKET_1',
    'Main Hand': 'MAIN_HAND',
    'One-Hand': 'MAIN_HAND',
    'Two-Hand': 'MAIN_HAND',
    'Off Hand': 'OFF_HAND',
    'Held In Off-hand': 'OFF_HAND',
    'Shield': 'OFF_HAND',
    'Ranged': 'RANGED',
};

/**
 * Map game slug to WoW variant for the boss/loot API.
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

/**
 * Props passed via PluginSlot context from event-detail-page.
 */
interface BossLootPanelProps {
    contentInstances: Record<string, unknown>[];
    eventId?: number;
    gameSlug?: string;
    characterId?: string;
}

/**
 * Boss & Loot Preview Panel — shows boss encounter order and loot tables
 * for each content instance on the event detail page.
 *
 * ROK-247: Boss & Loot Preview on Events (Classic)
 */
export function BossLootPanel({
    contentInstances,
    gameSlug,
    characterId,
}: BossLootPanelProps) {
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);
    const [panelOpen, setPanelOpen] = useState(true);

    // Extract instance IDs from the loosely-typed contentInstances array
    const instances = useMemo(
        () =>
            contentInstances
                .map((ci) => ({
                    id: typeof ci.id === 'number' ? ci.id : Number(ci.id ?? ci.instanceId),
                    name: typeof ci.name === 'string' ? ci.name : undefined,
                }))
                .filter((inst) => !isNaN(inst.id) && inst.id > 0),
        [contentInstances],
    );

    const { data: character } = useCharacterDetail(characterId);
    const wowheadVariant = character?.gameVariant ?? variant;

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

    if (!instances.length) return null;

    return (
        <div className="boss-loot-panel">
            <div
                className={`boss-loot-panel__header ${panelOpen ? 'boss-loot-panel__header--expanded' : 'boss-loot-panel__header--collapsed'}`}
                onClick={() => setPanelOpen((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPanelOpen((v) => !v);
                    }
                }}
            >
                <h2 className="boss-loot-panel__title">
                    <span className="boss-loot-panel__title-icon">⚔️</span>
                    Boss &amp; Loot
                </h2>
                <span className={`boss-loot-panel__chevron ${panelOpen ? 'boss-loot-panel__chevron--open' : ''}`}>
                    ▸
                </span>
            </div>

            {panelOpen && instances.map((inst) => (
                <InstanceBossList
                    key={inst.id}
                    instanceId={inst.id}
                    instanceName={inst.name}
                    variant={variant}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={character?.class}
                    hasCharacter={!!characterId}
                />
            ))}
        </div>
    );
}

/**
 * Boss list for a single content instance.
 */
function InstanceBossList({
    instanceId,
    instanceName,
    variant,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    instanceId: number;
    instanceName?: string;
    variant: string;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    const { data: bosses, isLoading } = useBossesForInstance(instanceId, variant);
    const [expandedBossIds, setExpandedBossIds] = useState<Set<number>>(new Set());

    const toggleBoss = (bossId: number) => {
        setExpandedBossIds((prev) => {
            const next = new Set(prev);
            if (next.has(bossId)) {
                next.delete(bossId);
            } else {
                next.add(bossId);
            }
            return next;
        });
    };

    if (isLoading) {
        return (
            <div className="boss-loot-instance">
                {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
                <div className="boss-loot-body__loading">Loading bosses…</div>
            </div>
        );
    }

    if (!bosses || bosses.length === 0) return null;

    return (
        <div className="boss-loot-instance">
            {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
            {bosses.map((boss) => (
                <BossRow
                    key={boss.id}
                    boss={boss}
                    isExpanded={expandedBossIds.has(boss.id)}
                    onToggle={() => toggleBoss(boss.id)}
                    variant={variant}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={characterClass}
                    hasCharacter={hasCharacter}
                />
            ))}
        </div>
    );
}

/**
 * A single boss row with collapsible loot table.
 */
function BossRow({
    boss,
    isExpanded,
    onToggle,
    variant,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    boss: BossEncounterDto;
    isExpanded: boolean;
    onToggle: () => void;
    variant: string;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    // Only fetch loot when expanded
    const { data: loot, isLoading: lootLoading } = useLootForBoss(
        isExpanded ? boss.id : undefined,
        variant,
    );

    // Refresh Wowhead tooltips when loot loads
    useWowheadTooltips([loot]);

    return (
        <div className="boss-row">
            <div
                className="boss-row__header"
                onClick={onToggle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle();
                    }
                }}
            >
                <span className={`boss-row__chevron ${isExpanded ? 'boss-row__chevron--open' : ''}`}>
                    ▸
                </span>
                <span className="boss-row__order">{boss.order}</span>
                <span className="boss-row__name">
                    {boss.name}
                </span>
                {boss.sodModified && <span className="boss-row__sod-badge">SoD</span>}
                <a
                    className="boss-row__wowhead-link"
                    href={getWowheadNpcSearchUrl(boss.name, wowheadVariant)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="View on Wowhead"
                >
                    ↗
                </a>
            </div>

            {isExpanded && (
                <BossLootBody
                    loot={loot}
                    isLoading={lootLoading}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={characterClass}
                    hasCharacter={hasCharacter}
                />
            )}
        </div>
    );
}

/**
 * Loot table rendered under an expanded boss row.
 * Uses the same WowItemCard + ItemComparison pattern as quest prep rewards.
 */
function BossLootBody({
    loot,
    isLoading,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    loot: BossLootDto[] | undefined;
    isLoading: boolean;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    const [filterUsable, setFilterUsable] = useState(false);
    const wowheadSuffix = getWowheadDataSuffix(wowheadVariant);

    if (isLoading) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__loading">Loading loot…</div>
            </div>
        );
    }

    if (!loot || loot.length === 0) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__empty">No loot data available</div>
            </div>
        );
    }

    // Check if item is usable by character class
    const isUsableByClass = (item: BossLootDto): boolean => {
        if (!characterClass || !item.classRestrictions || item.classRestrictions.length === 0) {
            return true;
        }
        return item.classRestrictions.some(
            (c) => c.toLowerCase() === characterClass.toLowerCase(),
        );
    };

    const hasClassRestrictions = loot.some(
        (item) => item.classRestrictions && item.classRestrictions.length > 0,
    );

    // Apply class filter
    const displayLoot = filterUsable
        ? loot.filter(isUsableByClass)
        : loot;

    return (
        <div className="boss-loot-body">
            {/* Filter bar — only show when there are class restrictions */}
            {hasCharacter && hasClassRestrictions && (
                <div className="boss-loot-filter">
                    <button
                        className={`boss-loot-filter__toggle ${filterUsable ? 'boss-loot-filter__toggle--active' : ''}`}
                        onClick={() => setFilterUsable((v) => !v)}
                    >
                        {filterUsable ? '✓ My class only' : 'All classes'}
                    </button>
                </div>
            )}

            <div className="boss-loot-grid">
                {displayLoot.map((item) => {
                    const usable = isUsableByClass(item);
                    const equipSlot = item.slot ? LOOT_TO_EQUIP_SLOT[item.slot] ?? item.slot : null;
                    const equippedItem = equipSlot
                        ? equippedBySlot.get(equipSlot)
                        : undefined;

                    return (
                        <div
                            key={item.id}
                            className={`boss-loot-item-wrapper ${!usable && !filterUsable ? 'boss-loot-item-wrapper--dimmed' : ''}`}
                        >
                            <WowItemCard
                                itemId={item.itemId}
                                name={item.itemName}
                                quality={item.quality}
                                slot={item.slot}
                                itemLevel={item.itemLevel}
                                iconUrl={item.iconUrl}
                                wowheadUrl={getWowheadItemUrl(item.itemId, wowheadVariant)}
                                wowheadData={`item=${item.itemId}&${wowheadSuffix}`}
                            />

                            {/* Item comparison with equipped item — same as quest prep */}
                            {equipSlot && hasCharacter && (
                                <ItemComparison
                                    rewardItemLevel={item.itemLevel}
                                    equippedItem={equippedItem}
                                    gameVariant={wowheadVariant}
                                />
                            )}

                            {/* Drop rate + class restrictions row */}
                            {(item.dropRate || (item.classRestrictions && item.classRestrictions.length > 0)) && (
                                <div className="boss-loot-item__meta">
                                    {item.classRestrictions && item.classRestrictions.length > 0 && (
                                        <span className="boss-loot-item__class-tag">
                                            {item.classRestrictions.join(', ')}
                                        </span>
                                    )}
                                    {item.dropRate && (
                                        <span className="boss-loot-item__drop-rate">
                                            {(parseFloat(item.dropRate) * 100).toFixed(0)}% drop
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


/** Map loot slot names to character equipment slot names for upgrade detection */
const LOOT_TO_EQUIP_SLOT: Record<string, string> = {
    'Head': 'HEAD',
    'Neck': 'NECK',
    'Shoulder': 'SHOULDER',
    'Back': 'BACK',
    'Chest': 'CHEST',
    'Wrist': 'WRIST',
    'Hands': 'HANDS',
    'Waist': 'WAIST',
    'Legs': 'LEGS',
    'Feet': 'FEET',
    'Finger': 'FINGER_1',
    'Trinket': 'TRINKET_1',
    'Main Hand': 'MAIN_HAND',
    'One-Hand': 'MAIN_HAND',
    'Two-Hand': 'MAIN_HAND',
    'Off Hand': 'OFF_HAND',
    'Held In Off-hand': 'OFF_HAND',
    'Shield': 'OFF_HAND',
    'Ranged': 'RANGED',
};

/**
 * Map game slug to WoW variant for the boss/loot API.
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

/**
 * Props passed via PluginSlot context from event-detail-page.
 */
interface BossLootPanelProps {
    contentInstances: Record<string, unknown>[];
    eventId?: number;
    gameSlug?: string;
    characterId?: string;
}

/**
 * Boss & Loot Preview Panel — shows boss encounter order and loot tables
 * for each content instance on the event detail page.
 *
 * ROK-247: Boss & Loot Preview on Events (Classic)
 */
export function BossLootPanel({
    contentInstances,
    gameSlug,
    characterId,
}: BossLootPanelProps) {
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);
    const [panelOpen, setPanelOpen] = useState(true);

    // Extract instance IDs from the loosely-typed contentInstances array
    const instances = useMemo(
        () =>
            contentInstances
                .map((ci) => ({
                    id: typeof ci.id === 'number' ? ci.id : Number(ci.id ?? ci.instanceId),
                    name: typeof ci.name === 'string' ? ci.name : undefined,
                }))
                .filter((inst) => !isNaN(inst.id) && inst.id > 0),
        [contentInstances],
    );

    const { data: character } = useCharacterDetail(characterId);
    const wowheadVariant = character?.gameVariant ?? variant;

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

    if (!instances.length) return null;

    return (
        <div className="boss-loot-panel">
            <div
                className={`boss-loot-panel__header ${panelOpen ? 'boss-loot-panel__header--expanded' : 'boss-loot-panel__header--collapsed'}`}
                onClick={() => setPanelOpen((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPanelOpen((v) => !v);
                    }
                }}
            >
                <h2 className="boss-loot-panel__title">
                    <span className="boss-loot-panel__title-icon">⚔️</span>
                    Boss &amp; Loot
                </h2>
                <span className={`boss-loot-panel__chevron ${panelOpen ? 'boss-loot-panel__chevron--open' : ''}`}>
                    ▸
                </span>
            </div>

            {panelOpen && instances.map((inst) => (
                <InstanceBossList
                    key={inst.id}
                    instanceId={inst.id}
                    instanceName={inst.name}
                    variant={variant}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={character?.class}
                    hasCharacter={!!characterId}
                />
            ))}
        </div>
    );
}

/**
 * Boss list for a single content instance.
 */
function InstanceBossList({
    instanceId,
    instanceName,
    variant,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    instanceId: number;
    instanceName?: string;
    variant: string;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    const { data: bosses, isLoading } = useBossesForInstance(instanceId, variant);
    const [expandedBossIds, setExpandedBossIds] = useState<Set<number>>(new Set());

    const toggleBoss = (bossId: number) => {
        setExpandedBossIds((prev) => {
            const next = new Set(prev);
            if (next.has(bossId)) {
                next.delete(bossId);
            } else {
                next.add(bossId);
            }
            return next;
        });
    };

    if (isLoading) {
        return (
            <div className="boss-loot-instance">
                {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
                <div className="boss-loot-body__loading">Loading bosses…</div>
            </div>
        );
    }

    if (!bosses || bosses.length === 0) return null;

    return (
        <div className="boss-loot-instance">
            {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
            {bosses.map((boss) => (
                <BossRow
                    key={boss.id}
                    boss={boss}
                    isExpanded={expandedBossIds.has(boss.id)}
                    onToggle={() => toggleBoss(boss.id)}
                    variant={variant}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={characterClass}
                    hasCharacter={hasCharacter}
                />
            ))}
        </div>
    );
}

/**
 * A single boss row with collapsible loot table.
 */
function BossRow({
    boss,
    isExpanded,
    onToggle,
    variant,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    boss: BossEncounterDto;
    isExpanded: boolean;
    onToggle: () => void;
    variant: string;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    // Only fetch loot when expanded
    const { data: loot, isLoading: lootLoading } = useLootForBoss(
        isExpanded ? boss.id : undefined,
        variant,
    );

    // Refresh Wowhead tooltips when loot loads
    useWowheadTooltips([loot]);

    return (
        <div className="boss-row">
            <div
                className="boss-row__header"
                onClick={onToggle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle();
                    }
                }}
            >
                <span className={`boss-row__chevron ${isExpanded ? 'boss-row__chevron--open' : ''}`}>
                    ▸
                </span>
                <span className="boss-row__order">{boss.order}</span>
                <span className="boss-row__name">
                    {boss.name}
                </span>
                {boss.sodModified && <span className="boss-row__sod-badge">SoD</span>}
                <a
                    className="boss-row__wowhead-link"
                    href={getWowheadNpcSearchUrl(boss.name, wowheadVariant)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="View on Wowhead"
                >
                    ↗
                </a>
            </div>

            {isExpanded && (
                <BossLootBody
                    loot={loot}
                    isLoading={lootLoading}
                    wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot}
                    characterClass={characterClass}
                    hasCharacter={hasCharacter}
                />
            )}
        </div>
    );
}

/**
 * Loot table rendered under an expanded boss row.
 */
function BossLootBody({
    loot,
    isLoading,
    wowheadVariant,
    equippedBySlot,
    characterClass,
    hasCharacter,
}: {
    loot: BossLootDto[] | undefined;
    isLoading: boolean;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}) {
    const [filterUsable, setFilterUsable] = useState(false);
    const wowheadSuffix = getWowheadDataSuffix(wowheadVariant);

    if (isLoading) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__loading">Loading loot…</div>
            </div>
        );
    }

    if (!loot || loot.length === 0) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__empty">No loot data available</div>
            </div>
        );
    }

    // Check if item is usable by character class
    const isUsableByClass = (item: BossLootDto): boolean => {
        if (!characterClass || !item.classRestrictions || item.classRestrictions.length === 0) {
            return true;
        }
        return item.classRestrictions.some(
            (c) => c.toLowerCase() === characterClass.toLowerCase(),
        );
    };

    // Compute upgrade delta
    const getUpgradeDelta = (item: BossLootDto): number | null => {
        if (!item.itemLevel || !item.slot) return null;
        const equipSlot = LOOT_TO_EQUIP_SLOT[item.slot];
        if (!equipSlot) return null;
        const equipped = equippedBySlot.get(equipSlot);
        if (!equipped || !equipped.itemLevel) return null;
        return item.itemLevel - equipped.itemLevel;
    };

    const hasClassRestrictions = loot.some(
        (item) => item.classRestrictions && item.classRestrictions.length > 0,
    );

    // Apply class filter
    const displayLoot = filterUsable
        ? loot.filter(isUsableByClass)
        : loot;

    return (
        <div className="boss-loot-body">
            {/* Filter bar — only show when there are class restrictions */}
            {hasCharacter && hasClassRestrictions && (
                <div className="boss-loot-filter">
                    <button
                        className={`boss-loot-filter__toggle ${filterUsable ? 'boss-loot-filter__toggle--active' : ''}`}
                        onClick={() => setFilterUsable((v) => !v)}
                    >
                        {filterUsable ? '✓ My class only' : 'All classes'}
                    </button>
                </div>
            )}

            <div className="boss-loot-grid">
                {displayLoot.map((item) => {
                    const usable = isUsableByClass(item);
                    const delta = hasCharacter ? getUpgradeDelta(item) : null;
                    const isUpgrade = delta !== null && delta > 0;

                    return (
                        <div
                            key={item.id}
                            className={`boss-loot-item ${!usable && !filterUsable ? 'boss-loot-item--dimmed' : ''}`}
                        >
                            <WowItemCard
                                itemId={item.itemId}
                                name={item.itemName}
                                quality={item.quality}
                                slot={item.slot}
                                itemLevel={item.itemLevel}
                                iconUrl={item.iconUrl}
                                wowheadUrl={getWowheadItemUrl(item.itemId, wowheadVariant)}
                                wowheadData={`item=${item.itemId}&${wowheadSuffix}`}
                            />

                            {/* Upgrade indicator */}
                            {isUpgrade && (
                                <span className="boss-loot-item__upgrade" title={`+${delta} iLvl upgrade`}>
                                    ▲ +{delta}
                                </span>
                            )}

                            {/* Class restrictions tag */}
                            {item.classRestrictions && item.classRestrictions.length > 0 && (
                                <span className="boss-loot-item__class-tag">
                                    {item.classRestrictions.join(', ')}
                                </span>
                            )}

                            {/* Drop rate */}
                            {item.dropRate && (
                                <span className="boss-loot-item__drop-rate">
                                    {(parseFloat(item.dropRate) * 100).toFixed(0)}%
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
