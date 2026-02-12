import { useState } from 'react';
import { useWowheadTooltips, isWowheadLoaded } from '../hooks/use-wowhead-tooltips';
import { ItemFallbackTooltip } from '../components/item-fallback-tooltip';
import { ItemDetailModal } from '../components/item-detail-modal';
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';

/** Quality color mapping for WoW item quality */
const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500',
    COMMON: 'text-gray-300',
    UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400',
    EPIC: 'text-purple-400',
    LEGENDARY: 'text-orange-400',
};

const LEFT_SLOTS = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST'];
const RIGHT_SLOTS = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2'];
const BOTTOM_SLOTS = ['MAIN_HAND', 'OFF_HAND', 'RANGED'];

const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulders', BACK: 'Back',
    CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrists',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER_1: 'Ring 1', FINGER_2: 'Ring 2', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', RANGED: 'Ranged',
};

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

function getWowheadUrl(itemId: number, gameVariant: string | null): string {
    const { urlBase } = getWowheadDomain(gameVariant);
    return `https://${urlBase}/item=${itemId}`;
}

function getWowheadDataAttr(itemId: number, gameVariant: string | null): string {
    const { tooltipDomain } = getWowheadDomain(gameVariant);
    return `item=${itemId}&domain=${tooltipDomain}`;
}

function buildOrderedItems(equipment: CharacterEquipmentDto): EquipmentItemDto[] {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));
    const ordered: EquipmentItemDto[] = [];
    for (const slot of [...LEFT_SLOTS, ...RIGHT_SLOTS, ...BOTTOM_SLOTS]) {
        const item = itemsBySlot.get(slot);
        if (item) ordered.push(item);
    }
    return ordered;
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
        POOR: 'border-gray-600', COMMON: 'border-gray-500', UNCOMMON: 'border-green-600',
        RARE: 'border-blue-600', EPIC: 'border-purple-600', LEGENDARY: 'border-orange-600',
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderSlotColumn(LEFT_SLOTS)}
                    {renderSlotColumn(RIGHT_SLOTS)}
                </div>
            )}
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

/** Props passed via PluginSlot context from character-detail-page */
interface CharacterDetailSectionsProps {
    equipment: CharacterEquipmentDto;
    gameVariant: string | null;
    renderUrl: string | null;
    isArmoryImported: boolean;
}

export function CharacterDetailSections({
    equipment,
    gameVariant,
    renderUrl,
    isArmoryImported,
}: CharacterDetailSectionsProps) {
    const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);

    useWowheadTooltips([equipment]);

    const orderedItems = buildOrderedItems(equipment);

    function handleItemClick(item: EquipmentItemDto) {
        const idx = orderedItems.findIndex((i) => i.slot === item.slot);
        if (idx >= 0) setSelectedItemIndex(idx);
    }

    return (
        <>
            <div className="bg-panel border border-edge rounded-lg p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                {equipment.items.length > 0 ? (
                    <EquipmentGrid
                        equipment={equipment}
                        gameVariant={gameVariant}
                        renderUrl={renderUrl}
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

            <ItemDetailModal
                isOpen={selectedItemIndex !== null}
                onClose={() => setSelectedItemIndex(null)}
                items={orderedItems}
                currentIndex={selectedItemIndex ?? 0}
                onNavigate={setSelectedItemIndex}
                gameVariant={gameVariant}
            />
        </>
    );
}
