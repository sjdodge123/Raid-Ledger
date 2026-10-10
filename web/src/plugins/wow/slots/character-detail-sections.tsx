/**
 * Character detail sections: equipment grid and talents display.
 * Props passed via PluginSlot context from character-detail-page.
 *
 * ROK-1726: the effective WoW variant is resolved ONCE here (D6) and passed
 * to the grid, the item modal, talents and the empty states. Manual WoW:
 * Forever characters carry `gameVariant: null` + a `ruleset`; the ruleset is
 * read from the page's own character query (same cache key, no extra
 * request), so core's slot context needs no WoW field.
 */
import { useState } from 'react';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { FOREVER_ADDON_HINT_EQUIPMENT, getWowVariantIntegrations, resolveWowVariant } from '../lib/wow-variant-config';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { ItemDetailModal } from '../components/item-detail-modal';
import { TalentDisplay } from '../components/talent-display';
import { CharacterProfessionsPanel } from '../components/CharacterProfessionsPanel';
import { CharacterQuestsSection } from '../components/character-quests-section';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import { EquipmentGrid } from './equipment-grid';
import { buildOrderedItems } from './equipment-constants';
import type {
    CharacterEquipmentDto,
    CharacterProfessionsDto,
    EquipmentItemDto,
} from '@raid-ledger/contract';

/** Props passed via PluginSlot context from character-detail-page */
interface CharacterDetailSectionsProps {
    equipment: CharacterEquipmentDto | null;
    talents: unknown;
    professions: CharacterProfessionsDto | null;
    gameVariant: string | null;
    renderUrl: string | null;
    isArmoryImported: boolean;
    characterClass: string | null;
    isOwner: boolean;
    characterId: string;
    gameId: number;
}

/** Equipment panel with items and item detail modal */
function EquipmentWithItems({ equipment, gameVariant, renderUrl, isArmoryImported }: {
    equipment: CharacterEquipmentDto; gameVariant: string | null; renderUrl: string | null; isArmoryImported: boolean;
}) {
    const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);
    const orderedItems = buildOrderedItems(equipment);

    function handleItemClick(item: EquipmentItemDto) {
        const idx = orderedItems.findIndex((i) => i.slot === item.slot);
        if (idx >= 0) setSelectedItemIndex(idx);
    }

    return (
        <>
            <div className="bg-panel border border-edge rounded-lg p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                <EquipmentSourceLine equipment={equipment} />
                {equipment.items.length > 0 ? (
                    <EquipmentGrid equipment={equipment} gameVariant={gameVariant}
                        renderUrl={renderUrl} onItemClick={handleItemClick} />
                ) : (
                    <EquipmentEmptyMessage isArmoryImported={isArmoryImported} gameVariant={gameVariant} />
                )}
            </div>
            <ItemDetailModal isOpen={selectedItemIndex !== null} onClose={() => setSelectedItemIndex(null)}
                items={orderedItems} currentIndex={selectedItemIndex ?? 0}
                onNavigate={setSelectedItemIndex} gameVariant={gameVariant} />
        </>
    );
}

/** Source line under the Equipment heading; Armory equipment (or absent source) shows nothing new. */
function EquipmentSourceLine({ equipment }: { equipment: CharacterEquipmentDto }) {
    if (equipment.source !== 'addon') return null;
    return <p className="-mt-3 mb-4 text-xs text-muted">{formatAddonSourceLine(equipment.syncedAt)}</p>;
}

/** Main character detail sections component */
export function CharacterDetailSections({
    equipment, talents, professions, gameVariant,
    renderUrl, isArmoryImported, characterClass,
    isOwner, characterId, gameId,
}: CharacterDetailSectionsProps) {
    useWowheadTooltips(equipment ? [equipment] : []);
    const { data: character } = useCharacterDetail(characterId);
    const variant = resolveWowVariant({ gameVariant, ruleset: character?.ruleset });

    return (
        <>
            {equipment ? (
                <EquipmentWithItems equipment={equipment} gameVariant={variant}
                    renderUrl={renderUrl} isArmoryImported={isArmoryImported} />
            ) : (
                <EquipmentEmptyState isArmoryImported={isArmoryImported} gameVariant={variant} />
            )}
            <TalentSection talents={talents} isArmoryImported={isArmoryImported}
                characterClass={characterClass} gameVariant={variant} />
            <CharacterQuestsSection characterId={characterId} variant={variant} />
            <CharacterProfessionsPanel professions={professions}
                isOwner={isOwner} characterId={characterId} gameId={gameId} />
        </>
    );
}

/** Empty state when no equipment data is available */
function EquipmentEmptyState({ isArmoryImported, gameVariant }: { isArmoryImported: boolean; gameVariant: string | null }) {
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
            <EquipmentEmptyMessage isArmoryImported={isArmoryImported} gameVariant={gameVariant} />
        </div>
    );
}

function equipmentEmptyHint(isArmoryImported: boolean, gameVariant: string | null): string {
    if (isArmoryImported) return 'Equipment data may not be available for this character. Try refreshing.';
    // A variant the Armory cannot import (WoW: Forever) gets the addon hint, not the Armory copy (AC5).
    if (getWowVariantIntegrations(gameVariant)?.armoryImport === false) return FOREVER_ADDON_HINT_EQUIPMENT;
    return 'Equipment data is only available for characters imported from the Blizzard Armory.';
}

/** Empty message content for equipment section */
function EquipmentEmptyMessage({ isArmoryImported, gameVariant }: { isArmoryImported: boolean; gameVariant: string | null }) {
    return (
        <div className="text-center py-8 text-muted">
            <p className="text-lg">No equipment data</p>
            <p className="text-sm mt-1">{equipmentEmptyHint(isArmoryImported, gameVariant)}</p>
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
