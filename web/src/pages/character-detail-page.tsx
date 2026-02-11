import { useParams, useNavigate } from 'react-router-dom';
import { useCharacterDetail } from '../hooks/use-character-detail';
import { useRefreshCharacterFromArmory, useUpdateCharacter } from '../hooks/use-character-mutations';
import { useWowheadTooltips, isWowheadLoaded } from '../hooks/use-wowhead-tooltips';
import { ItemFallbackTooltip } from '../components/characters/item-fallback-tooltip';
import { ItemDetailModal } from '../components/characters/item-detail-modal';
import { useAuth } from '../hooks/use-auth';
import { useState, useEffect, useRef } from 'react';
import type { CharacterEquipmentDto, EquipmentItemDto, CharacterRole } from '@raid-ledger/contract';

/** Quality color mapping for WoW item quality */
const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500',
    COMMON: 'text-gray-300',
    UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400',
    EPIC: 'text-purple-400',
    LEGENDARY: 'text-orange-400',
};

/** WoW equipment slot layout — left column */
const LEFT_SLOTS = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST'];
/** WoW equipment slot layout — right column */
const RIGHT_SLOTS = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2'];
/** WoW equipment slot layout — bottom (weapons) */
const BOTTOM_SLOTS = ['MAIN_HAND', 'OFF_HAND', 'RANGED'];

/** Human-readable slot names */
const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head',
    NECK: 'Neck',
    SHOULDER: 'Shoulders',
    BACK: 'Back',
    CHEST: 'Chest',
    SHIRT: 'Shirt',
    TABARD: 'Tabard',
    WRIST: 'Wrists',
    HANDS: 'Hands',
    WAIST: 'Waist',
    LEGS: 'Legs',
    FEET: 'Feet',
    FINGER_1: 'Ring 1',
    FINGER_2: 'Ring 2',
    TRINKET_1: 'Trinket 1',
    TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand',
    OFF_HAND: 'Off Hand',
    RANGED: 'Ranged',
};

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

/** Map game variant to Wowhead domain info */
function getWowheadDomain(gameVariant: string | null): { urlBase: string; tooltipDomain: string } {
    switch (gameVariant) {
        case 'classic_anniversary':
            return { urlBase: 'www.wowhead.com/tbc', tooltipDomain: 'tbc' };
        case 'classic':
        case 'classic_era':
            return { urlBase: 'classic.wowhead.com', tooltipDomain: 'classic' };
        default:
            return { urlBase: 'www.wowhead.com', tooltipDomain: 'www' };
    }
}

/** Get Wowhead URL for an item based on game variant */
function getWowheadUrl(itemId: number, gameVariant: string | null): string {
    const { urlBase } = getWowheadDomain(gameVariant);
    return `https://${urlBase}/item=${itemId}`;
}

/** Get data-wowhead attribute value for Wowhead tooltips */
function getWowheadDataAttr(itemId: number, gameVariant: string | null): string {
    const { tooltipDomain } = getWowheadDomain(gameVariant);
    return `item=${itemId}&domain=${tooltipDomain}`;
}

/** Build ordered item list from slot arrays (for modal navigation) */
function buildOrderedItems(equipment: CharacterEquipmentDto): EquipmentItemDto[] {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));
    const ordered: EquipmentItemDto[] = [];
    for (const slot of [...LEFT_SLOTS, ...RIGHT_SLOTS, ...BOTTOM_SLOTS]) {
        const item = itemsBySlot.get(slot);
        if (item) ordered.push(item);
    }
    return ordered;
}

interface RoleEditorProps {
    characterId: string;
    effectiveRole: CharacterRole | null;
    hasOverride: boolean;
}

function RoleEditor({ characterId, effectiveRole, hasOverride }: RoleEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const updateMutation = useUpdateCharacter();
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    function handleRoleChange(newRole: CharacterRole | null) {
        updateMutation.mutate({
            id: characterId,
            dto: { roleOverride: newRole },
        });
        setIsOpen(false);
    }

    const roles: Array<{ value: CharacterRole; label: string; color: string }> = [
        { value: 'tank', label: 'TANK', color: 'bg-blue-600' },
        { value: 'healer', label: 'HEALER', color: 'bg-emerald-600' },
        { value: 'dps', label: 'DPS', color: 'bg-red-600' },
    ];

    if (!isOpen) {
        return (
            <span className="inline-flex items-center gap-1">
                <button
                    onClick={() => setIsOpen(true)}
                    className={`px-2 py-0.5 rounded text-xs text-foreground transition-colors ${
                        effectiveRole
                            ? `${ROLE_COLORS[effectiveRole] ?? 'bg-faint'} hover:opacity-80`
                            : 'bg-faint/50 text-muted hover:bg-faint border border-dashed border-edge'
                    }`}
                    title="Click to change role"
                >
                    {effectiveRole ? effectiveRole.toUpperCase() : 'Set Role'}
                </button>
                {hasOverride && (
                    <span className="text-xs text-amber-400" title="Manual role override active">
                        <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </span>
                )}
            </span>
        );
    }

    return (
        <div className="relative inline-block" ref={dropdownRef}>
            <div className="absolute z-10 top-full mt-1 bg-panel border border-edge rounded-lg shadow-lg p-2 min-w-[140px]">
                {roles.map((r) => (
                    <button
                        key={r.value}
                        onClick={() => handleRoleChange(r.value)}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-2 ${
                            effectiveRole === r.value
                                ? `${r.color} text-foreground`
                                : 'text-muted hover:bg-overlay hover:text-foreground'
                        }`}
                    >
                        {r.label}
                    </button>
                ))}
                {hasOverride && (
                    <button
                        onClick={() => handleRoleChange(null)}
                        className="w-full text-left px-3 py-1.5 text-xs rounded text-muted hover:bg-overlay hover:text-foreground mt-1 border-t border-edge"
                    >
                        Clear Override
                    </button>
                )}
            </div>
        </div>
    );
}

interface EquipmentSlotProps {
    item: EquipmentItemDto | undefined;
    slotName: string;
    gameVariant: string | null;
    onItemClick?: () => void;
}

function EquipmentSlot({ item, slotName, gameVariant, onItemClick }: EquipmentSlotProps) {
    const [showFallback, setShowFallback] = useState(false);

    if (!item) {
        return (
            <div className="flex items-center gap-3 p-2 rounded bg-overlay/30 border border-edge/50 min-h-[52px]">
                <div className="w-8 h-8 rounded bg-faint/50 flex items-center justify-center text-xs text-muted/50">
                    --
                </div>
                <div className="min-w-0">
                    <div className="text-xs text-muted/50">{SLOT_LABELS[slotName] ?? slotName}</div>
                    <div className="text-xs text-muted/30">Empty</div>
                </div>
            </div>
        );
    }

    const qualityClass = QUALITY_COLORS[item.quality.toUpperCase()] ?? 'text-gray-300';
    const qualityBorder: Record<string, string> = {
        POOR: 'border-gray-600',
        COMMON: 'border-gray-500',
        UNCOMMON: 'border-green-600',
        RARE: 'border-blue-600',
        EPIC: 'border-purple-600',
        LEGENDARY: 'border-orange-600',
    };
    const iconBorderClass = qualityBorder[item.quality.toUpperCase()] ?? 'border-gray-500';

    return (
        <div
            className="relative flex items-center gap-3 p-2 rounded bg-overlay border border-edge min-h-[52px] cursor-pointer hover:bg-overlay/80 transition-colors"
            onClick={onItemClick}
            onMouseEnter={() => setShowFallback(true)}
            onMouseLeave={() => setShowFallback(false)}
        >
            {item.iconUrl ? (
                <img
                    src={item.iconUrl}
                    alt={item.name}
                    className={`w-8 h-8 rounded border ${iconBorderClass} flex-shrink-0`}
                    onError={(e) => {
                        // Fall back to item level display if icon fails
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                />
            ) : null}
            <div className={`w-8 h-8 rounded bg-faint flex items-center justify-center text-xs text-muted font-mono flex-shrink-0${item.iconUrl ? ' hidden' : ''}`}>
                {item.itemLevel > 0 ? item.itemLevel : '--'}
            </div>
            <div className="min-w-0 flex-1">
                <a
                    href={getWowheadUrl(item.itemId, gameVariant)}
                    data-wowhead={getWowheadDataAttr(item.itemId, gameVariant)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-sm font-medium truncate block ${qualityClass} hover:underline`}
                    onClick={(e) => e.preventDefault()}
                >
                    {item.name}
                </a>
                <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{SLOT_LABELS[item.slot] ?? item.slot}</span>
                    {item.itemSubclass && (
                        <>
                            <span>·</span>
                            <span>{item.itemSubclass}</span>
                        </>
                    )}
                </div>
                {item.enchantments && item.enchantments.length > 0 && (
                    <div className="text-xs text-green-400 truncate">
                        {item.enchantments[0].displayString}
                    </div>
                )}
                {item.sockets && item.sockets.length > 0 && (
                    <div className="flex items-center gap-1">
                        {item.sockets.map((s, i) => (
                            <span
                                key={i}
                                className={`w-3 h-3 rounded-full border ${s.itemId ? 'bg-blue-500/40 border-blue-500/60' : 'bg-faint border-edge'}`}
                                title={`${s.socketType}${s.itemId ? ' (filled)' : ' (empty)'}`}
                            />
                        ))}
                    </div>
                )}
            </div>
            {/* Fallback tooltip when Wowhead is unavailable */}
            {showFallback && !isWowheadLoaded() && (
                <ItemFallbackTooltip item={item} />
            )}
        </div>
    );
}

interface EquipmentGridProps {
    equipment: CharacterEquipmentDto;
    gameVariant: string | null;
    renderUrl: string | null;
    onItemClick: (item: EquipmentItemDto) => void;
}

function EquipmentGrid({ equipment, gameVariant, renderUrl, onItemClick }: EquipmentGridProps) {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));

    const renderSlotColumn = (slots: string[]) => (
        <div className="space-y-2">
            {slots.map((slot) => (
                <EquipmentSlot
                    key={slot}
                    item={itemsBySlot.get(slot)}
                    slotName={slot}
                    gameVariant={gameVariant}
                    onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined}
                />
            ))}
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Desktop with render: 3-column layout (left | render | right) */}
            {renderUrl ? (
                <>
                    <div className="hidden lg:grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
                        {renderSlotColumn(LEFT_SLOTS)}
                        <div className="flex items-center justify-center px-2">
                            <img
                                src={renderUrl}
                                alt="Character render"
                                className="max-h-[600px] object-contain drop-shadow-lg"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                        </div>
                        {renderSlotColumn(RIGHT_SLOTS)}
                    </div>
                    {/* Mobile/tablet with render: render above, then 2-column */}
                    <div className="lg:hidden space-y-4">
                        <div className="flex justify-center">
                            <img
                                src={renderUrl}
                                alt="Character render"
                                className="max-h-[300px] object-contain drop-shadow-lg"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {renderSlotColumn(LEFT_SLOTS)}
                            {renderSlotColumn(RIGHT_SLOTS)}
                        </div>
                    </div>
                </>
            ) : (
                /* No render: standard 2-column layout */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderSlotColumn(LEFT_SLOTS)}
                    {renderSlotColumn(RIGHT_SLOTS)}
                </div>
            )}
            {/* Bottom row — weapons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {BOTTOM_SLOTS.map((slot) => (
                    <EquipmentSlot
                        key={slot}
                        item={itemsBySlot.get(slot)}
                        slotName={slot}
                        gameVariant={gameVariant}
                        onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined}
                    />
                ))}
            </div>
        </div>
    );
}

function timeAgo(dateString: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function CharacterDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data: character, isLoading, error } = useCharacterDetail(id);
    const { user } = useAuth();
    const refreshMutation = useRefreshCharacterFromArmory();
    const [cooldownRemaining, setCooldownRemaining] = useState(0);
    const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);

    const isOwner = user && character && user.id === character.userId;
    const isArmoryImported = !!character?.lastSyncedAt;

    // Refresh Wowhead tooltips when equipment data changes
    useWowheadTooltips([character?.equipment]);

    // Build ordered items list for modal navigation
    const orderedItems = character?.equipment ? buildOrderedItems(character.equipment) : [];

    // Cooldown timer
    useEffect(() => {
        if (!character?.lastSyncedAt) return;
        const lastSync = new Date(character.lastSyncedAt).getTime();
        const cooldownMs = 5 * 60 * 1000;

        function update() {
            const remaining = Math.max(0, Math.ceil((cooldownMs - (Date.now() - lastSync)) / 1000));
            setCooldownRemaining(remaining);
        }

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [character?.lastSyncedAt]);

    function handleRefresh() {
        if (!character || cooldownRemaining > 0) return;
        refreshMutation.mutate({
            id: character.id,
            dto: {
                region: (character.region as 'us' | 'eu' | 'kr' | 'tw') ?? 'us',
                gameVariant: (character.gameVariant as 'retail' | 'classic_era' | 'classic' | 'classic_anniversary') ?? undefined,
            },
        });
    }

    function handleItemClick(item: EquipmentItemDto) {
        const idx = orderedItems.findIndex((i) => i.slot === item.slot);
        if (idx >= 0) setSelectedItemIndex(idx);
    }

    if (isLoading) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 w-48 bg-overlay rounded" />
                    <div className="h-32 bg-overlay rounded-lg" />
                    <div className="h-64 bg-overlay rounded-lg" />
                </div>
            </div>
        );
    }

    if (error || !character) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="bg-red-950/50 border border-red-900 rounded-lg p-6 text-center">
                    <p className="text-red-400">{error?.message ?? 'Character not found'}</p>
                    <button onClick={() => navigate(-1)} className="text-blue-400 hover:underline mt-2 inline-block">
                        Go back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
            {/* Back link */}
            <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
            </button>

            {/* Character Header */}
            <div className="bg-panel border border-edge rounded-lg p-6">
                <div className="flex items-start gap-4">
                    {/* Large avatar */}
                    {character.avatarUrl ? (
                        <img
                            src={character.avatarUrl}
                            alt={character.name}
                            className="w-20 h-20 rounded-full bg-overlay flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-overlay flex items-center justify-center text-3xl text-muted flex-shrink-0">
                            👤
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-2xl font-bold text-foreground">{character.name}</h1>
                            {character.faction && (
                                <span className={`px-2 py-0.5 rounded text-sm font-medium border ${FACTION_STYLES[character.faction] ?? 'bg-faint text-muted'}`}>
                                    {character.faction.charAt(0).toUpperCase() + character.faction.slice(1)}
                                </span>
                            )}
                            {isOwner ? (
                                <RoleEditor
                                    characterId={character.id}
                                    effectiveRole={character.effectiveRole as CharacterRole | null}
                                    hasOverride={character.roleOverride != null}
                                />
                            ) : character.effectiveRole ? (
                                <span className={`px-2 py-0.5 rounded text-xs text-foreground ${ROLE_COLORS[character.effectiveRole] ?? 'bg-faint'}`}>
                                    {character.effectiveRole.toUpperCase()}
                                </span>
                            ) : null}
                            {character.isMain && (
                                <span className="text-yellow-400" title="Main character">⭐ Main</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted mt-1 flex-wrap">
                            {character.level && <span className="text-amber-400">Level {character.level}</span>}
                            {character.race && <><span>·</span><span>{character.race}</span></>}
                            {character.class && <><span>·</span><span>{character.class}</span></>}
                            {character.spec && <><span>·</span><span>{character.spec}</span></>}
                            {character.realm && <><span>·</span><span>{character.realm}</span></>}
                        </div>

                        {/* Item level & sync info */}
                        <div className="flex items-center gap-4 mt-3 flex-wrap">
                            {character.itemLevel && (
                                <div className="text-sm">
                                    <span className="text-muted">Item Level </span>
                                    <span className="text-purple-400 font-semibold text-lg">{character.itemLevel}</span>
                                </div>
                            )}
                            {character.equipment?.equippedItemLevel && character.equipment.equippedItemLevel !== character.itemLevel && (
                                <div className="text-sm">
                                    <span className="text-muted">Equipped </span>
                                    <span className="text-purple-300 font-semibold">{character.equipment.equippedItemLevel}</span>
                                </div>
                            )}
                            {character.lastSyncedAt && (
                                <span className="text-xs text-muted">
                                    Updated {timeAgo(character.lastSyncedAt)}
                                </span>
                            )}
                            {character.profileUrl && (
                                <a
                                    href={character.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"
                                >
                                    View on Armory
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                </a>
                            )}
                        </div>

                        {/* Refresh button (owner only) */}
                        {isOwner && isArmoryImported && (
                            <div className="mt-3">
                                <button
                                    onClick={handleRefresh}
                                    disabled={refreshMutation.isPending || cooldownRemaining > 0}
                                    className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 disabled:text-muted text-foreground rounded transition-colors inline-flex items-center gap-2"
                                >
                                    {refreshMutation.isPending ? (
                                        <>
                                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Refreshing...
                                        </>
                                    ) : cooldownRemaining > 0 ? (
                                        <>Refresh ({Math.floor(cooldownRemaining / 60)}:{String(cooldownRemaining % 60).padStart(2, '0')})</>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Refresh from Armory
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Equipment Section */}
            <div className="bg-panel border border-edge rounded-lg p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                {character.equipment && character.equipment.items.length > 0 ? (
                    <EquipmentGrid
                        equipment={character.equipment}
                        gameVariant={character.gameVariant}
                        renderUrl={character.renderUrl}
                        onItemClick={handleItemClick}
                    />
                ) : (
                    <div className="text-center py-8 text-muted">
                        <p className="text-lg">No equipment data</p>
                        <p className="text-sm mt-1">
                            {isArmoryImported
                                ? 'Equipment data may not be available for this character. Try refreshing.'
                                : 'Equipment data is only available for characters imported from the Blizzard Armory.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Item Detail Modal */}
            <ItemDetailModal
                isOpen={selectedItemIndex !== null}
                onClose={() => setSelectedItemIndex(null)}
                items={orderedItems}
                currentIndex={selectedItemIndex ?? 0}
                onNavigate={setSelectedItemIndex}
                gameVariant={character.gameVariant}
            />
        </div>
    );
}
