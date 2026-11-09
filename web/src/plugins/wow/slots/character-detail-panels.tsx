/**
 * The WoW character page panels and layout A (ROK-2146), shared by the owned
 * sections and (ROK-2149) the read-only roster-member sections. Moved out of
 * `character-detail-sections.tsx` unchanged.
 */
import { useState, type ReactNode } from 'react';
import { FOREVER_ADDON_HINT_EQUIPMENT, getWowVariantIntegrations } from '../lib/wow-variant-config';
import { ItemDetailModal } from '../components/item-detail-modal';
import { TalentDisplay } from '../components/talent-display';
import { formatAddonSourceLine } from '../lib/addon-source-line';
import { EquipmentGrid } from './equipment-grid';
import { buildOrderedItems } from './equipment-constants';
import type { ForeverPortrait } from '../lib/forever-portrait';
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';

/** Equipment panel with items and item detail modal */
export function EquipmentWithItems({ equipment, gameVariant, renderUrl, portrait, isArmoryImported }: {
    equipment: CharacterEquipmentDto; gameVariant: string | null; renderUrl: string | null;
    portrait: ForeverPortrait; isArmoryImported: boolean;
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
                        renderUrl={renderUrl} portrait={portrait} onItemClick={handleItemClick} />
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

export type SectionPanels = Record<'equipment' | 'talents' | 'quests' | 'professions' | 'lockouts' | 'addons', ReactNode>;

/**
 * >= lg: main column + 320px sidebar; the sidebar hides when every panel in it is
 * empty, and only a non-empty sidebar widens the page (character-detail-page.tsx).
 * Below lg both columns are `display: contents`, so their panels join one stack and
 * `order` moves Quests (then Guild recommends) after the sidebar's reference panels.
 * Layout A is for every WoW variant, not only Forever (Lead ruling on review MINOR-5): a
 * variant without the sidebar panels gets the plain stack via the empty-sidebar hide.
 * Quests and Guild recommends are wrapped for that order; `empty:hidden` keeps a
 * wrapper whose panel renders null from leaving a gap. The other panels stay unwrapped.
 */
export function SectionsLayout({ panels }: { panels: SectionPanels }) {
    return (
        <div data-sections-layout="sidebar" className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div data-sections-column="main" className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-6">
                {panels.equipment}{panels.talents}
                <div data-sections-slot="quests" className={`${SLOT_WRAPPER} max-lg:order-1`}>{panels.quests}</div>
            </div>
            <aside data-sections-column="sidebar"
                className="contents lg:flex lg:w-80 lg:shrink-0 lg:flex-col lg:gap-6 lg:[&:not(:has(>:not(:empty)))]:hidden">
                {panels.professions}{panels.lockouts}
                <div data-sections-slot="addons" className={`${SLOT_WRAPPER} max-lg:order-2`}>{panels.addons}</div>
            </aside>
        </div>
    );
}

const SLOT_WRAPPER = 'flex flex-col gap-6 empty:hidden';

/**
 * Neutral Equipment + Talents panels while the game registry resolves the
 * variant (ROK-1751): no Armory copy and no addon hint, so the page does not
 * flip from one to the other once the registry answers.
 */
export function VariantPendingSections() {
    return (
        <>
            {['Equipment', 'Talents'].map((title) => (
                <div key={title} className="bg-panel border border-edge rounded-lg p-6" aria-busy="true">
                    <h2 className="text-lg font-semibold text-foreground mb-4">{title}</h2>
                    <div className="h-16 rounded-md bg-overlay animate-pulse" />
                </div>
            ))}
        </>
    );
}

/** Empty state when no equipment data is available */
export function EquipmentEmptyState({ isArmoryImported, gameVariant }: { isArmoryImported: boolean; gameVariant: string | null }) {
    return (
        <div className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
            <EquipmentEmptyMessage isArmoryImported={isArmoryImported} gameVariant={gameVariant} />
        </div>
    );
}

function equipmentEmptyHint(isArmoryImported: boolean, gameVariant: string | null): string {
    if (isArmoryImported) return 'Equipment data may not be available for this character. Try refreshing.';
    // A variant whose data comes from the addon (WoW: Forever) gets the addon hint (AC5).
    if (getWowVariantIntegrations(gameVariant)?.addonHints === true) return FOREVER_ADDON_HINT_EQUIPMENT;
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
export function TalentSection({ talents, isArmoryImported, characterClass, gameVariant }: {
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
