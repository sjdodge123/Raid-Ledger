import { Link } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

interface CharacterCardCompactProps {
    /** Full CharacterDto — preferred. */
    character?: CharacterDto;
    /** Flat props (legacy). If `character` is provided these are ignored. */
    id?: string;
    name?: string;
    avatarUrl?: string | null;
    faction?: string | null;
    level?: number | null;
    race?: string | null;
    className?: string | null;
    spec?: string | null;
    role?: string | null;
    itemLevel?: number | null;
    isMain?: boolean;
    /** Visual size variant: 'default' for standard, 'sm' for compact/onboarding. */
    size?: 'default' | 'sm';
}

/**
 * Shared read-only character card used in event attendees, public profiles,
 * and onboarding. Handles mobile responsively with truncation and ellipsis.
 *
 * ROK-445: Extracted as the single source of truth for read-only character
 * card rendering. Replaces CharacterCardCompact, PublicCharacterCard, and
 * MiniCharacterCard to prevent visual drift.
 */
export function CharacterCardCompact({
    character,
    id: idProp,
    name: nameProp,
    avatarUrl: avatarUrlProp,
    faction: factionProp,
    level: levelProp,
    race: raceProp,
    className: classNameProp,
    spec: specProp,
    role: roleProp,
    itemLevel: itemLevelProp,
    isMain: isMainProp,
    size = 'default',
}: CharacterCardCompactProps) {
    // Resolve values: prefer character DTO, fall back to flat props
    const charId = character?.id ?? idProp ?? '';
    const charName = character?.name ?? nameProp ?? '';
    const avatarUrl = character?.avatarUrl ?? avatarUrlProp;
    const faction = character?.faction ?? factionProp;
    const level = character?.level ?? levelProp;
    const race = character?.race ?? raceProp;
    const charClass = character?.class ?? classNameProp;
    const spec = character?.spec ?? specProp;
    const role = character?.effectiveRole ?? roleProp;
    const itemLevel = character?.itemLevel ?? itemLevelProp;
    const isMain = character?.isMain ?? isMainProp;

    const isSm = size === 'sm';
    const avatarSize = isSm ? 'w-8 h-8' : 'w-10 h-10';
    const padding = isSm ? 'p-3' : 'p-4';
    const nameTextSize = isSm ? 'text-sm' : '';
    const metaTextSize = isSm ? 'text-xs' : 'text-sm';

    return (
        <Link
            to={`/characters/${charId}`}
            className={`bg-panel border border-edge rounded-lg ${padding} flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity`}
        >
            {/* Avatar */}
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={charName}
                    className={`${avatarSize} rounded-full bg-overlay flex-shrink-0`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : (
                <div className={`${avatarSize} rounded-full bg-overlay flex items-center justify-center text-muted flex-shrink-0`}>
                    👤
                </div>
            )}

            {/* Text content */}
            <div className="min-w-0 overflow-hidden">
                {/* Name row */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium text-foreground truncate max-w-[180px] sm:max-w-none ${nameTextSize}`}>
                        {charName}
                    </span>
                    {isMain && (
                        <span className="text-yellow-400 text-xs font-semibold inline-flex items-center gap-0.5 flex-shrink-0">
                            ⭐ Main
                        </span>
                    )}
                    {faction && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${FACTION_STYLES[faction] ?? 'bg-faint text-muted'}`}>
                            {faction.charAt(0).toUpperCase() + faction.slice(1)}
                        </span>
                    )}
                </div>

                {/* Metadata row */}
                <div className={`flex items-center gap-1.5 ${metaTextSize} text-muted flex-wrap`}>
                    {level != null && level > 0 && (
                        <>
                            <span className="text-amber-400">Lv.{level}</span>
                            <span>•</span>
                        </>
                    )}
                    {race && <span className="truncate max-w-[100px] sm:max-w-none">{race}</span>}
                    {race && charClass && <span>•</span>}
                    {charClass && <span className="truncate max-w-[100px] sm:max-w-none">{charClass}</span>}
                    {spec && <span className="truncate max-w-[80px] sm:max-w-none">• {spec}</span>}
                    {role && (
                        <span className={`px-1.5 py-0.5 rounded text-xs text-foreground flex-shrink-0 ${ROLE_COLORS[role] ?? 'bg-faint'}`}>
                            {role.toUpperCase()}
                        </span>
                    )}
                    {itemLevel != null && itemLevel > 0 && (
                        <>
                            <span>•</span>
                            <span className="text-purple-400 whitespace-nowrap">{itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>
        </Link>
    );
}
