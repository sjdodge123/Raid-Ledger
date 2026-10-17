import type { EquipmentItemDto } from '@raid-ledger/contract';

const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500',
    COMMON: 'text-gray-300',
    UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400',
    EPIC: 'text-purple-400',
    LEGENDARY: 'text-orange-400',
};

const BINDING_LABELS: Record<string, string> = {
    ON_EQUIP: 'Binds when equipped',
    ON_ACQUIRE: 'Binds when picked up',
    ON_USE: 'Binds when used',
};

interface ItemFallbackTooltipProps {
    item: EquipmentItemDto;
}

/**
 * Custom fallback tooltip shown when Wowhead script is unavailable.
 * Positioned absolute — parent must be `relative`.
 */
function TooltipBasicInfo({ item, qualityClass }: { item: EquipmentItemDto; qualityClass: string }) {
    return (
        <>
            <div className={`font-semibold text-sm ${qualityClass}`}>{item.name}</div>
            {item.itemLevel > 0 && <div className="text-xs text-yellow-400">Item Level {item.itemLevel}</div>}
            {item.binding && <div className="text-xs text-gray-400">{BINDING_LABELS[item.binding] ?? item.binding}</div>}
            {item.itemSubclass && <div className="text-xs text-gray-400">{item.itemSubclass}</div>}
            {item.armor != null && item.armor > 0 && <div className="text-xs text-gray-300 mt-1">{item.armor} Armor</div>}
            {item.weapon && (
                <div className="text-xs text-gray-300 mt-1">
                    <div>{item.weapon.damageMin} - {item.weapon.damageMax} Damage</div>
                    <div>Speed {item.weapon.attackSpeed.toFixed(2)}</div>
                    <div>({item.weapon.dps.toFixed(1)} damage per second)</div>
                </div>
            )}
        </>
    );
}

function TooltipEnhancements({ item }: { item: EquipmentItemDto }) {
    return (
        <>
            {item.stats && item.stats.length > 0 && (
                <div className="mt-1 space-y-0.5">
                    {item.stats.map((stat, i) => <div key={i} className="text-xs text-green-400">+{stat.value} {stat.name}</div>)}
                </div>
            )}
            {item.enchantments && item.enchantments.length > 0 && (
                <div className="mt-1">
                    {item.enchantments.map((e, i) => <div key={i} className="text-xs text-green-400">{e.displayString}</div>)}
                </div>
            )}
            {item.sockets && item.sockets.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                    {item.sockets.map((s, i) => (
                        <span key={i} className={`w-3 h-3 rounded-full border ${s.itemId ? 'bg-blue-500/40 border-blue-500/60' : 'bg-gray-700 border-gray-500'}`} title={s.socketType} />
                    ))}
                </div>
            )}
        </>
    );
}

function TooltipFooter({ item }: { item: EquipmentItemDto }) {
    return (
        <>
            {item.requiredLevel != null && <div className="text-xs text-gray-400 mt-1">Requires Level {item.requiredLevel}</div>}
            {item.setName && <div className="text-xs text-yellow-300 mt-1">{item.setName}</div>}
            {item.description && <div className="text-xs text-yellow-600 italic mt-1">&quot;{item.description}&quot;</div>}
        </>
    );
}

export function ItemFallbackTooltip({ item }: ItemFallbackTooltipProps) {
    const qualityClass = QUALITY_COLORS[item.quality.toUpperCase()] ?? 'text-gray-300';
    return (
        <div className="absolute z-50 left-full ml-2 top-0 w-72 bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-xl pointer-events-none">
            <TooltipBasicInfo item={item} qualityClass={qualityClass} />
            <TooltipEnhancements item={item} />
            <TooltipFooter item={item} />
        </div>
    );
}
