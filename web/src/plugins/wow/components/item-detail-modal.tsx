import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { EquipmentItemDto } from '@raid-ledger/contract';

const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500',
    COMMON: 'text-gray-300',
    UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400',
    EPIC: 'text-purple-400',
    LEGENDARY: 'text-orange-400',
};

const QUALITY_BORDER: Record<string, string> = {
    POOR: 'border-gray-500/40',
    COMMON: 'border-gray-400/40',
    UNCOMMON: 'border-green-500/40',
    RARE: 'border-blue-500/40',
    EPIC: 'border-purple-500/40',
    LEGENDARY: 'border-orange-500/40',
};

const BINDING_LABELS: Record<string, string> = {
    ON_EQUIP: 'Binds when equipped',
    ON_ACQUIRE: 'Binds when picked up',
    ON_USE: 'Binds when used',
};

const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulders', BACK: 'Back',
    CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrists',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER_1: 'Ring 1', FINGER_2: 'Ring 2', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', RANGED: 'Ranged',
};

interface ItemDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    items: EquipmentItemDto[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    gameVariant: string | null;
}

function getWowheadUrl(itemId: number, gameVariant: string | null): string {
    let urlBase: string;
    switch (gameVariant) {
        case 'classic_anniversary':
            urlBase = 'www.wowhead.com/tbc';
            break;
        case 'classic':
        case 'classic_era':
            urlBase = 'classic.wowhead.com';
            break;
        default:
            urlBase = 'www.wowhead.com';
            break;
    }
    return `https://${urlBase}/item=${itemId}`;
}

export function ItemDetailModal({ isOpen, onClose, items, currentIndex, onNavigate, gameVariant }: ItemDetailModalProps) {
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                onNavigate((currentIndex - 1 + items.length) % items.length);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                onNavigate((currentIndex + 1) % items.length);
            }
        },
        [onClose, onNavigate, currentIndex, items.length],
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen || items.length === 0) return null;

    const item = items[currentIndex];
    const normalizedQuality = item.quality.toUpperCase();
    const qualityClass = QUALITY_COLORS[normalizedQuality] ?? 'text-gray-300';
    const borderClass = QUALITY_BORDER[normalizedQuality] ?? 'border-edge';

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Modal Content */}
            <div
                className={`relative bg-surface border-2 ${borderClass} rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden`}
                role="dialog"
                aria-modal="true"
            >
                {/* Header with navigation */}
                <div className="flex items-center justify-between p-4 border-b border-edge">
                    <button
                        onClick={() => onNavigate((currentIndex - 1 + items.length) % items.length)}
                        className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                        aria-label="Previous item"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <span className="text-sm text-muted">{currentIndex + 1} / {items.length}</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onNavigate((currentIndex + 1) % items.length)}
                            className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                            aria-label="Next item"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                            aria-label="Close"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto max-h-[calc(90vh-5rem)] space-y-3">
                    {/* Item name with icon */}
                    <div className="flex items-start gap-3">
                        {item.iconUrl && (
                            <img
                                src={item.iconUrl}
                                alt={item.name}
                                className={`w-10 h-10 rounded border-2 flex-shrink-0 ${QUALITY_BORDER[normalizedQuality]?.replace('/40', '') ?? 'border-edge'}`}
                            />
                        )}
                        <div>
                            <h3 className={`text-lg font-bold ${qualityClass}`}>{item.name}</h3>
                            {item.itemLevel > 0 && (
                                <div className="text-sm text-yellow-400">Item Level {item.itemLevel}</div>
                            )}
                        </div>
                    </div>

                    {/* Binding */}
                    {item.binding && (
                        <div className="text-sm text-muted">{BINDING_LABELS[item.binding] ?? item.binding}</div>
                    )}

                    {/* Slot and type */}
                    <div className="flex items-center justify-between text-sm text-muted">
                        <span>{SLOT_LABELS[item.slot] ?? item.slot}</span>
                        {item.itemSubclass && <span>{item.itemSubclass}</span>}
                    </div>

                    {/* Armor */}
                    {item.armor != null && item.armor > 0 && (
                        <div className="text-sm text-foreground">{item.armor} Armor</div>
                    )}

                    {/* Weapon info */}
                    {item.weapon && (
                        <div className="text-sm text-foreground space-y-0.5">
                            <div className="flex justify-between">
                                <span>{item.weapon.damageMin} - {item.weapon.damageMax} Damage</span>
                                <span>Speed {item.weapon.attackSpeed.toFixed(2)}</span>
                            </div>
                            <div>({item.weapon.dps.toFixed(1)} damage per second)</div>
                        </div>
                    )}

                    {/* Stats */}
                    {item.stats && item.stats.length > 0 && (
                        <div className="space-y-0.5">
                            {item.stats.map((stat, i) => (
                                <div key={i} className="text-sm text-green-400">+{stat.value} {stat.name}</div>
                            ))}
                        </div>
                    )}

                    {/* Enchantments */}
                    {item.enchantments && item.enchantments.length > 0 && (
                        <div className="space-y-0.5">
                            {item.enchantments.map((e, i) => (
                                <div key={i} className="text-sm text-green-400">{e.displayString}</div>
                            ))}
                        </div>
                    )}

                    {/* Sockets */}
                    {item.sockets && item.sockets.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            {item.sockets.map((s, i) => (
                                <span
                                    key={i}
                                    className={`w-4 h-4 rounded-full border-2 ${s.itemId ? 'bg-blue-500/40 border-blue-500/60' : 'bg-faint border-edge'}`}
                                    title={`${s.socketType}${s.itemId ? ' (filled)' : ' (empty)'}`}
                                />
                            ))}
                        </div>
                    )}

                    {/* Required level */}
                    {item.requiredLevel != null && (
                        <div className="text-sm text-muted">Requires Level {item.requiredLevel}</div>
                    )}

                    {/* Set name */}
                    {item.setName && (
                        <div className="text-sm text-yellow-300">{item.setName}</div>
                    )}

                    {/* Description */}
                    {item.description && (
                        <div className="text-sm text-yellow-600 italic">&quot;{item.description}&quot;</div>
                    )}

                    {/* Wowhead link */}
                    <div className="pt-2 border-t border-edge">
                        <a
                            href={getWowheadUrl(item.itemId, gameVariant)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1"
                        >
                            View on Wowhead
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
