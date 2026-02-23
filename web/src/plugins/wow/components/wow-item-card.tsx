/**
 * WowItemCard — Shared item display component for WoW items.
 *
 * Used by: quest prep panel rewards, item comparison equipped items,
 * character detail equipment slots, boss loot tables (ROK-247).
 *
 * Renders an item with icon, quality-colored border and name,
 * slot/subclass info, and optional enchant/item level.
 */
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

export function WowItemCard({
    name,
    quality,
    slot,
    subclass,
    itemLevel,
    iconUrl,
    enchant,
    wowheadData,
    wowheadUrl,
    className,
}: WowItemCardProps) {
    const qKey = qualityKey(quality);
    const slotLabel = slot ? (SLOT_LABELS[slot] ?? slot) : null;

    return (
        <div className={`wow-item-card ${className ?? ''}`}>
            {/* Icon */}
            {iconUrl ? (
                <img
                    src={iconUrl}
                    alt={name}
                    className={`wow-item-card__icon wow-item-card__icon--${qKey}`}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const next = e.currentTarget.nextElementSibling;
                        if (next) (next as HTMLElement).style.display = 'flex';
                    }}
                />
            ) : null}
            <div
                className="wow-item-card__icon-fallback"
                style={iconUrl ? { display: 'none' } : undefined}
            >
                {itemLevel && itemLevel > 0 ? itemLevel : '—'}
            </div>

            {/* Content */}
            <div className="wow-item-card__content">
                <div className={`wow-item-card__name wow-item-card__name--${qKey}`}>
                    {wowheadUrl ? (
                        <a
                            href={wowheadUrl}
                            data-wowhead={wowheadData}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {name}
                        </a>
                    ) : (
                        name
                    )}
                </div>
                {(slotLabel || subclass) && (
                    <div className="wow-item-card__meta">
                        {slotLabel && <span>{slotLabel}</span>}
                        {slotLabel && subclass && <span>·</span>}
                        {subclass && <span>{subclass}</span>}
                    </div>
                )}
                {enchant && (
                    <div className="wow-item-card__enchant">{enchant}</div>
                )}
            </div>

            {/* Item level badge */}
            {itemLevel != null && itemLevel > 0 && (
                <span className="wow-item-card__ilvl">iL{itemLevel}</span>
            )}
        </div>
    );
}
