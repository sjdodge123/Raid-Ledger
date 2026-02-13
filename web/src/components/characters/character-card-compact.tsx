import { Link } from 'react-router-dom';

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface CharacterCardCompactProps {
    id: string;
    name: string;
    avatarUrl?: string | null;
    faction?: string | null;
    level?: number | null;
    race?: string | null;
    className?: string | null;
    spec?: string | null;
    role?: string | null;
    itemLevel?: number | null;
}

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

/**
 * Compact, read-only character card used in event attendees and public profiles.
 * Mirrors the visual style of the profile CharacterCard but without action buttons.
 */
export function CharacterCardCompact({
    id,
    name,
    avatarUrl,
    faction,
    level,
    race,
    className: charClass,
    spec,
    role,
    itemLevel,
}: CharacterCardCompactProps) {
    return (
        <Link
            to={`/characters/${id}`}
            className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
        >
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={name}
                    className="w-10 h-10 rounded-full bg-overlay flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : (
                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-muted flex-shrink-0">
                    👤
                </div>
            )}

            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{name}</span>
                    {faction && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${FACTION_STYLES[faction] ?? 'bg-faint text-muted'}`}>
                            {faction.charAt(0).toUpperCase() + faction.slice(1)}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                    {level != null && level > 0 && (
                        <>
                            <span className="text-amber-400">Lv.{level}</span>
                            <span>•</span>
                        </>
                    )}
                    {race && <span>{race}</span>}
                    {race && charClass && <span>•</span>}
                    {charClass && <span>{charClass}</span>}
                    {spec && <span>• {spec}</span>}
                    {role && (
                        <span className={`px-1.5 py-0.5 rounded text-xs text-foreground ${ROLE_COLORS[role] ?? 'bg-faint'}`}>
                            {role.toUpperCase()}
                        </span>
                    )}
                    {itemLevel != null && itemLevel > 0 && (
                        <>
                            <span>•</span>
                            <span className="text-purple-400">{itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>
        </Link>
    );
}
