/**
 * Equipment grid and slot components for the character detail page.
 * Renders WoW character equipment in a paperdoll-style layout.
 */
import { useState } from 'react';
import { isWowheadLoaded } from '../hooks/use-wowhead-tooltips';
import { ItemFallbackTooltip } from '../components/item-fallback-tooltip';
import { getWowheadItemUrl, getWowheadItemData } from '../lib/wowhead-urls';
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';
import {
    QUALITY_COLORS, QUALITY_BORDERS, SLOT_LABELS,
    LEFT_SLOTS, RIGHT_SLOTS, BOTTOM_SLOTS,
} from './equipment-constants';

/** Single equipment slot with item display or empty placeholder */
export function EquipmentSlot({ item, slotName, gameVariant, onItemClick }: {
    item: EquipmentItemDto | undefined; slotName: string;
    gameVariant: string | null; onItemClick?: () => void;
}) {
    const [showFallback, setShowFallback] = useState(false);

    if (!item) {
        return (
            <div className="flex items-center gap-3 p-2 rounded bg-overlay/30 border border-edge/50 min-h-[52px]">
                <div className="w-8 h-8 rounded bg-faint/50 flex items-center justify-center text-xs text-muted/50">--</div>
                <div className="min-w-0">
                    <div className="text-xs text-muted/50">{SLOT_LABELS[slotName] ?? slotName}</div>
                    <div className="text-xs text-muted/30">Empty</div>
                </div>
            </div>
        );
    }

    const qualityClass = QUALITY_COLORS[item.quality.toUpperCase()] ?? 'text-gray-300';
    const iconBorderClass = QUALITY_BORDERS[item.quality.toUpperCase()] ?? 'border-gray-500';

    return (
        <div
            className="relative flex items-center gap-3 p-2 rounded bg-overlay border border-edge min-h-[52px] cursor-pointer hover:bg-overlay/80 transition-colors"
            onClick={onItemClick}
            onMouseEnter={() => setShowFallback(true)}
            onMouseLeave={() => setShowFallback(false)}
        >
            {item.iconUrl ? (
                <img src={item.iconUrl} alt={item.name}
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
            <SlotItemDetails item={item} qualityClass={qualityClass} gameVariant={gameVariant} />
            {showFallback && !isWowheadLoaded() && <ItemFallbackTooltip item={item} />}
        </div>
    );
}

/** Item name, slot label, subclass, enchantments and sockets */
function SlotItemDetails({ item, qualityClass, gameVariant }: {
    item: EquipmentItemDto; qualityClass: string; gameVariant: string | null;
}) {
    return (
        <div className="min-w-0 flex-1">
            <a href={getWowheadItemUrl(item.itemId, gameVariant)}
                data-wowhead={getWowheadItemData(item.itemId, gameVariant)}
                target="_blank" rel="noopener noreferrer"
                className={`text-sm font-medium truncate block ${qualityClass} hover:underline`}
                onClick={(e) => e.preventDefault()}>
                {item.name}
            </a>
            <div className="flex items-center gap-2 text-xs text-muted">
                <span>{SLOT_LABELS[item.slot] ?? item.slot}</span>
                {item.itemSubclass && (<><span>·</span><span>{item.itemSubclass}</span></>)}
            </div>
            {item.enchantments && item.enchantments.length > 0 && (
                <div className="text-xs text-green-400 truncate">{item.enchantments[0].displayString}</div>
            )}
            {item.sockets && item.sockets.length > 0 && (
                <div className="flex items-center gap-1">
                    {item.sockets.map((s, i) => (
                        <span key={i}
                            className={`w-3 h-3 rounded-full border ${s.itemId ? 'bg-blue-500/40 border-blue-500/60' : 'bg-faint border-edge'}`}
                            title={`${s.socketType}${s.itemId ? ' (filled)' : ' (empty)'}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/** Equipment grid with responsive paperdoll layout */
export function EquipmentGrid({ equipment, gameVariant, renderUrl, onItemClick }: {
    equipment: CharacterEquipmentDto; gameVariant: string | null;
    renderUrl: string | null; onItemClick: (item: EquipmentItemDto) => void;
}) {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));

    const renderSlotColumn = (slots: string[]) => (
        <div className="space-y-2">
            {slots.map((slot) => (
                <EquipmentSlot key={slot} item={itemsBySlot.get(slot)} slotName={slot}
                    gameVariant={gameVariant}
                    onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined}
                />
            ))}
        </div>
    );

    return (
        <div className="space-y-4">
            {renderUrl ? (
                <EquipmentWithRender renderUrl={renderUrl} renderSlotColumn={renderSlotColumn} />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderSlotColumn(LEFT_SLOTS)}
                    {renderSlotColumn(RIGHT_SLOTS)}
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {BOTTOM_SLOTS.map((slot) => (
                    <EquipmentSlot key={slot} item={itemsBySlot.get(slot)} slotName={slot}
                        gameVariant={gameVariant}
                        onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined}
                    />
                ))}
            </div>
        </div>
    );
}

/** Desktop and mobile layouts with character render image */
function EquipmentWithRender({ renderUrl, renderSlotColumn }: {
    renderUrl: string; renderSlotColumn: (slots: string[]) => JSX.Element;
}) {
    return (
        <>
            <div className="hidden lg:grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
                {renderSlotColumn(LEFT_SLOTS)}
                <div className="flex items-center justify-center px-2">
                    <img src={renderUrl} alt="Character render"
                        className="max-h-[600px] object-contain drop-shadow-lg"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>
                {renderSlotColumn(RIGHT_SLOTS)}
            </div>
            <div className="lg:hidden space-y-4">
                <div className="flex justify-center">
                    <img src={renderUrl} alt="Character render"
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
    );
}
