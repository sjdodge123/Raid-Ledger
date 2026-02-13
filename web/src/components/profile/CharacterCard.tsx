import { Link } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useDeleteCharacter } from '../../hooks/use-character-mutations';
import { PluginSlot } from '../../plugins';

interface CharacterCardProps {
    character: CharacterDto;
    onEdit: (character: CharacterDto) => void;
}

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

/**
 * Card displaying a single character with actions.
 * Enhanced for ROK-234: shows level, race, faction badge for Armory-imported characters.
 * Click-through to character detail page for equipment view.
 * ROK-206: "Set as main" moved into Edit Character modal.
 */
export function CharacterCard({ character, onEdit }: CharacterCardProps) {
    const deleteMutation = useDeleteCharacter();

    function handleDelete() {
        const shouldDelete = window.confirm(`Are you sure you want to delete ${character.name}?`);
        if (shouldDelete) {
            deleteMutation.mutate(character.id);
        }
    }

    const roleColors: Record<string, string> = {
        tank: 'bg-blue-600',
        healer: 'bg-emerald-600',
        dps: 'bg-red-600',
    };

    return (
        <div className="bg-panel border border-edge rounded-lg p-4 flex items-center justify-between gap-4">
            {/* Clickable character info → detail page */}
            <Link
                to={`/characters/${character.id}`}
                className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
            >
                {/* Avatar or placeholder */}
                {character.avatarUrl ? (
                    <img
                        src={character.avatarUrl}
                        alt={character.name}
                        className="w-10 h-10 rounded-full bg-overlay"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-muted">
                        👤
                    </div>
                )}

                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                            {character.name}
                        </span>
                        {/* Faction badge (ROK-234) */}
                        {character.faction && (
                            <span
                                className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                                    FACTION_STYLES[character.faction] ?? 'bg-faint text-muted'
                                }`}
                            >
                                {character.faction.charAt(0).toUpperCase() + character.faction.slice(1)}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted">
                        {/* Level (ROK-234) */}
                        {character.level && (
                            <>
                                <span className="text-amber-400">Lv.{character.level}</span>
                                <span>•</span>
                            </>
                        )}
                        {/* Race (ROK-234) */}
                        {character.race && <span>{character.race}</span>}
                        {character.race && character.class && <span>•</span>}
                        {character.class && <span>{character.class}</span>}
                        {character.spec && <span>• {character.spec}</span>}
                        {character.effectiveRole && (
                            <span
                                className={`px-1.5 py-0.5 rounded text-xs text-foreground ${roleColors[character.effectiveRole] || 'bg-faint'}`}
                            >
                                {character.effectiveRole.toUpperCase()}
                            </span>
                        )}
                        {character.itemLevel && (
                            <>
                                <span>•</span>
                                <span className="text-purple-400">{character.itemLevel} iLvl</span>
                            </>
                        )}
                    </div>
                </div>
            </Link>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Main badge */}
                {character.isMain && (
                    <span className="text-yellow-400 text-sm font-semibold inline-flex items-center gap-1" title="Main character">
                        ⭐ Main
                    </span>
                )}
                {/* Plugin slot for refresh button + armory link (ROK-242) */}
                <PluginSlot
                    name="profile:character-actions"
                    context={{
                        characterId: character.id,
                        lastSyncedAt: character.lastSyncedAt,
                        region: character.region,
                        gameVariant: character.gameVariant,
                        profileUrl: character.profileUrl,
                    }}
                />
                <button
                    onClick={() => onEdit(character)}
                    className="px-3 py-1.5 text-sm text-secondary hover:text-foreground hover:bg-overlay rounded transition-colors"
                >
                    Edit
                </button>
                <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded transition-colors"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
