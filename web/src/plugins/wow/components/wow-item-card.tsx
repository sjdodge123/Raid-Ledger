/**
 * WowItemCard — Shared item display component for WoW items.
 *
 * Used by: quest prep panel rewards, item comparison equipped items,
 * character detail equipment slots, boss loot tables (ROK-247).
 *
 * Renders an item with icon, quality-colored border and name,
 * slot/subclass info, and optional enchant/item level.
 *
 * ROK-501: On mobile viewports, tapping the item opens a modal instead of
 * relying on the Wowhead tooltip overlay (which double-renders over the card).
 */
import { useState } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { Modal } from '../../../components/ui/modal';
import './wow-item-card.css';

/** Slot label display names */
const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulders', BACK: 'Back',
    CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrists',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER: 'Ring', FINGER_1: 'Ring 1', FINGER_2: 'Ring 2',
    TRINKET: 'Trinket', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', ONE_HAND: 'One-Hand',
    TWO_HAND: 'Two-Hand', RANGED: 'Ranged', HELD_IN_OFF_HAND: 'Off Hand',
    // Wowhead reward slot names (title-case)
    'Head': 'Head', 'Neck': 'Neck', 'Shoulder': 'Shoulders', 'Back': 'Back',
    'Chest': 'Chest', 'Shirt': 'Shirt', 'Tabard': 'Tabard', 'Wrist': 'Wrists',
    'Hands': 'Hands', 'Waist': 'Waist', 'Legs': 'Legs', 'Feet': 'Feet',
    'Finger': 'Ring', 'Trinket': 'Trinket',
    'Main Hand': 'Main Hand', 'Off Hand': 'Off Hand', 'One-Hand': 'One-Hand',
    'Two-Hand': 'Two-Hand', 'Ranged': 'Ranged', 'Held In Off-hand': 'Off Hand',
    'Shield': 'Shield', 'Bindings': 'Bindings', 'Quest': 'Quest', 'Mount': 'Mount',
};

/**
 * Normalise quality string to lowercase key:
 *   "Uncommon" | "UNCOMMON" | "uncommon" → "uncommon"
 */
function qualityKey(quality: string): string {
    return quality.toLowerCase();
}

export interface WowItemCardProps {
    /** Wowhead item ID */
    itemId: number;
    /** Item display name */
    name: string;
    /** Quality: "Poor"|"Common"|"Uncommon"|"Rare"|"Epic"|"Legendary" (any case) */
    quality: string;
    /** Equipment slot (any convention — UPPER, title-case, or Wowhead-style) */
    slot?: string | null;
    /** Item sub-class (e.g., "Mace", "Cloth", "Plate") */
    subclass?: string | null;
    /** Item level */
    itemLevel?: number | null;
    /** Icon URL */
    iconUrl?: string | null;
    /** Enchant display string (e.g., "+5 Agility") */
    enchant?: string | null;
    /** Wowhead tooltip data attribute string (e.g., "item=12345&domain=classic") */
    wowheadData?: string;
    /** Full Wowhead URL for the item link */
    wowheadUrl?: string;
    /** Optional extra class name */
    className?: string;
}

function ItemIcon({ iconUrl, name, qKey, itemLevel }: {
    iconUrl?: string | null; name: string; qKey: string; itemLevel?: number | null;
}) {
    return (
        <>
            {iconUrl ? (
                <img src={iconUrl} alt={name} className={`wow-item-card__icon wow-item-card__icon--${qKey}`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; const next = e.currentTarget.nextElementSibling; if (next) (next as HTMLElement).style.display = 'flex'; }} />
            ) : null}
            <div className="wow-item-card__icon-fallback" style={iconUrl ? { display: 'none' } : undefined}>
                {itemLevel && itemLevel > 0 ? itemLevel : '—'}
            </div>
        </>
    );
}

function ItemCardContent({ name, qKey, slotLabel, subclass, enchant, wowheadUrl, wowheadData, isMobile, onLinkClick }: {
    name: string; qKey: string; slotLabel: string | null; subclass?: string | null;
    enchant?: string | null; wowheadUrl?: string; wowheadData?: string;
    isMobile: boolean; onLinkClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
    return (
        <div className="wow-item-card__content">
            <div className={`wow-item-card__name wow-item-card__name--${qKey}`}>
                {wowheadUrl ? (
                    <a href={wowheadUrl} data-wowhead={isMobile ? undefined : wowheadData}
                        target="_blank" rel="noopener noreferrer" onClick={onLinkClick}>{name}</a>
                ) : name}
            </div>
            {(slotLabel || subclass) && (
                <div className="wow-item-card__meta">
                    {slotLabel && <span>{slotLabel}</span>}
                    {slotLabel && subclass && <span>·</span>}
                    {subclass && <span>{subclass}</span>}
                </div>
            )}
            {enchant && <div className="wow-item-card__enchant">{enchant}</div>}
        </div>
    );
}

function ModalItemHeader({ name, qKey, iconUrl, itemLevel }: { name: string; qKey: string; iconUrl?: string | null; itemLevel?: number | null }) {
    return (
        <div className="flex items-center gap-3">
            {iconUrl && <img src={iconUrl} alt={name} className={`w-10 h-10 rounded border-2 flex-shrink-0 wow-item-card__icon--${qKey}`} />}
            <div>
                <div className={`text-base font-bold wow-item-card__name--${qKey}`}>{name}</div>
                {itemLevel != null && itemLevel > 0 && <div className="text-sm text-yellow-400">Item Level {itemLevel}</div>}
            </div>
        </div>
    );
}

function ItemMobileModal({ name, qKey, iconUrl, itemLevel, slotLabel, subclass, enchant, wowheadUrl, onClose }: {
    name: string; qKey: string; iconUrl?: string | null; itemLevel?: number | null;
    slotLabel: string | null; subclass?: string | null; enchant?: string | null;
    wowheadUrl?: string; onClose: () => void;
}) {
    return (
        <Modal isOpen onClose={onClose} title={name} maxWidth="max-w-sm">
            <div className="space-y-3">
                <ModalItemHeader name={name} qKey={qKey} iconUrl={iconUrl} itemLevel={itemLevel} />
                {(slotLabel || subclass) && (
                    <div className="flex items-center justify-between text-sm text-muted">
                        {slotLabel && <span>{slotLabel}</span>}
                        {subclass && <span>{subclass}</span>}
                    </div>
                )}
                {enchant && <div className="text-sm text-green-400">{enchant}</div>}
                {wowheadUrl && (
                    <div className="pt-2 border-t border-edge">
                        <a href={wowheadUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1">
                            View on Wowhead
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function WowItemCard({
    name, quality, slot, subclass, itemLevel, iconUrl,
    enchant, wowheadData, wowheadUrl, className,
}: WowItemCardProps) {
    const qKey = qualityKey(quality);
    const slotLabel = slot ? (SLOT_LABELS[slot] ?? slot) : null;
    const isMobile = useMediaQuery('(max-width: 768px)');
    const [modalOpen, setModalOpen] = useState(false);

    const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (isMobile) { e.preventDefault(); e.stopPropagation(); setModalOpen(true); }
    };

    return (
        <>
            <div className={`wow-item-card ${className ?? ''}`}>
                <ItemIcon iconUrl={iconUrl} name={name} qKey={qKey} itemLevel={itemLevel} />
                <ItemCardContent name={name} qKey={qKey} slotLabel={slotLabel} subclass={subclass}
                    enchant={enchant} wowheadUrl={wowheadUrl} wowheadData={wowheadData}
                    isMobile={isMobile} onLinkClick={handleLinkClick} />
                {itemLevel != null && itemLevel > 0 && <span className="wow-item-card__ilvl">iL{itemLevel}</span>}
            </div>
            {modalOpen && <ItemMobileModal name={name} qKey={qKey} iconUrl={iconUrl} itemLevel={itemLevel}
                slotLabel={slotLabel} subclass={subclass} enchant={enchant} wowheadUrl={wowheadUrl}
                onClose={() => setModalOpen(false)} />}
        </>
    );
}
