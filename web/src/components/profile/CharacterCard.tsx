import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useSetMainCharacter, useDeleteCharacter, useRefreshCharacterFromArmory } from '../../hooks/use-character-mutations';

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
 */
export function CharacterCard({ character, onEdit }: CharacterCardProps) {
    const setMainMutation = useSetMainCharacter();
    const deleteMutation = useDeleteCharacter();
    const refreshMutation = useRefreshCharacterFromArmory();
    const [cooldownRemaining, setCooldownRemaining] = useState(0);

    // Cooldown timer
    useEffect(() => {
        if (!character.lastSyncedAt) return;
        const lastSync = new Date(character.lastSyncedAt).getTime();
        const cooldownMs = 5 * 60 * 1000;

        function update() {
            const remaining = Math.max(0, Math.ceil((cooldownMs - (Date.now() - lastSync)) / 1000));
            setCooldownRemaining(remaining);
        }

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [character.lastSyncedAt]);

    function handleSetMain() {
        setMainMutation.mutate(character.id);
    }

    function handleDelete() {
        const shouldDelete = window.confirm(`Are you sure you want to delete ${character.name}?`);
        if (shouldDelete) {
            deleteMutation.mutate(character.id);
        }
    }

    function handleRefresh() {
        if (cooldownRemaining > 0) return;
        refreshMutation.mutate({
            id: character.id,
            dto: {
                region: (character.region as 'us' | 'eu' | 'kr' | 'tw') ?? 'us',
                gameVariant: (character.gameVariant as 'retail' | 'classic_era' | 'classic' | 'classic_anniversary') ?? undefined,
            },
        });
    }

    const roleColors: Record<string, string> = {
        tank: 'bg-blue-600',
        healer: 'bg-emerald-600',
        dps: 'bg-red-600',
    };

    const isArmoryImported = !!character.lastSyncedAt;

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
                        {character.isMain && (
                            <span className="text-yellow-400" title="Main character">
                                ⭐
                            </span>
                        )}
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
                {/* Refresh from Armory (ROK-234) — uses persisted region/gameVariant */}
                {isArmoryImported && (
                    <button
                        onClick={handleRefresh}
                        disabled={refreshMutation.isPending || cooldownRemaining > 0}
                        className="px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-950/50 disabled:text-muted disabled:hover:bg-transparent rounded transition-colors"
                        title={cooldownRemaining > 0 ? `Cooldown: ${Math.floor(cooldownRemaining / 60)}:${String(cooldownRemaining % 60).padStart(2, '0')}` : 'Refresh from Armory'}
                    >
                        {refreshMutation.isPending ? (
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        )}
                    </button>
                )}
                {/* Armory link */}
                {character.profileUrl && (
                    <a
                        href={character.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1.5 text-muted hover:text-blue-400 transition-colors"
                        title="View on Blizzard Armory"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </a>
                )}
                {!character.isMain && (
                    <button
                        onClick={handleSetMain}
                        disabled={setMainMutation.isPending}
                        className="px-3 py-1.5 text-sm text-secondary hover:text-foreground hover:bg-overlay rounded transition-colors"
                        title="Set as main"
                    >
                        ⭐ Main
                    </button>
                )}
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
