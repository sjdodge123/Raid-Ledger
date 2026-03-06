/**
 * Character detail sections: equipment grid and talents display.
 * Props passed via PluginSlot context from character-detail-page.
 */
import { useState } from 'react';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { ItemDetailModal } from '../components/item-detail-modal';
import { TalentDisplay } from '../components/talent-display';
import { EquipmentGrid } from './equipment-grid';
import { buildOrderedItems } from './equipment-constants';
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';

/** Props passed via PluginSlot context from character-detail-page */
interface CharacterDetailSectionsProps {
    equipment: CharacterEquipmentDto | null;
    talents: unknown;
    gameVariant: string | null;
    renderUrl: string | null;
    isArmoryImported: boolean;
    characterClass: string | null;
}

/** Main character detail sections component */
export function CharacterDetailSections({
    equipment, talents, gameVariant,
    renderUrl, isArmoryImported, characterClass,
}: CharacterDetailSectionsProps) {
    const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);

    useWowheadTooltips(equipment ? [equipment] : []);

    if (!equipment) {
        return (
            <>
                <EquipmentEmptyState isArmoryImported={isArmoryImported} />
                <TalentSection talents={talents} isArmoryImported={isArmoryImported}
                    characterClass={characterClass} gameVariant={gameVariant} />
            </>
        );
    }

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
                        equipment={equipment} gameVariant={gameVariant}
                        renderUrl={renderUrl} onItemClick={handleItemClick}
                    />
                ) : (
                    <EquipmentEmptyMessage isArmoryImported={isArmoryImported} />
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

            <TalentSection talents={talents} isArmoryImported={isArmoryImported}
                characterClass={characterClass} gameVariant={gameVariant} />
        </>
    );
}

/** Empty state when no equipment data is available */
function EquipmentEmptyState({ isArmoryImported }: { isArmoryImported: boolean }) {
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
            <EquipmentEmptyMessage isArmoryImported={isArmoryImported} />
        </div>
    );
}

/** Empty message content for equipment section */
function EquipmentEmptyMessage({ isArmoryImported }: { isArmoryImported: boolean }) {
    return (
        <div className="text-center py-8 text-muted">
            <p className="text-lg">No equipment data</p>
            <p className="text-sm mt-1">
                {isArmoryImported
                    ? 'Equipment data may not be available for this character. Try refreshing.'
                    : 'Equipment data is only available for characters imported from the Blizzard Armory.'}
            </p>
        </div>
    );
}

/** Talents section wrapper */
function TalentSection({ talents, isArmoryImported, characterClass, gameVariant }: {
    talents: unknown; isArmoryImported: boolean;
    characterClass: string | null; gameVariant: string | null;
}) {
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Talents</h2>
            <TalentDisplay talents={talents} isArmoryImported={isArmoryImported}
                characterClass={characterClass} gameVariant={gameVariant} />
        </div>
    );
}
