import { useState, useEffect, useMemo } from 'react';
import type { CharacterDto, CharacterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { BottomSheet } from '../ui/bottom-sheet';
import { useMyCharacters } from '../../hooks/use-characters';
import { InlineCharacterForm } from '../characters/inline-character-form';
import { useMediaQuery } from '../../hooks/use-media-query';
import { RoleIcon } from '../shared/RoleIcon';

interface SignupConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** ROK-439/452: Called when user confirms character/role selection BEFORE signup */
    onConfirm: (selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }) => void;
    /** ROK-439/529: Called when user has no characters and wants to sign up without one */
    onSkip: (options?: { preferredRoles?: CharacterRole[] }) => void;
    /** Whether the confirm action is in progress (signup mutation pending) */
    isConfirming?: boolean;
    gameId?: number;
    /** Game name for display */
    gameName?: string;
    /** Whether the game has roles (MMO fields) */
    hasRoles?: boolean;
    /** Whether the game slug is WoW */
    gameSlug?: string;
    /** Pre-selected role (e.g., from clicking an empty roster slot) */
    preSelectedRole?: CharacterRole;
}

/** Role display colors */
const ROLE_COLORS: Record<CharacterRole, string> = {
    tank: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    healer: 'bg-green-500/20 text-green-400 border-green-500/30',
    dps: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLES: CharacterRole[] = ['tank', 'healer', 'dps'];

/**
 * Pre-signup selection modal for character and role selection (ROK-439).
 * Opens BEFORE any signup API call — user picks character + role, then confirms.
 * Replaces the old post-signup confirmation pattern.
 */
export function SignupConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    onSkip,
    isConfirming = false,
    gameId,
    gameName,
    hasRoles = true,
    gameSlug,
    preSelectedRole,
}: SignupConfirmationModalProps) {
    const { data: charactersData, isLoading: isLoadingCharacters, isError, error } = useMyCharacters(gameId, isOpen);
    const isMobile = useMediaQuery('(max-width: 767px)');
    const characters = charactersData?.data ?? [];
    const mainCharacter = characters.find((c) => c.isMain);
    const altCharacters = characters.filter((c) => !c.isMain);

    // Track a "session key" that increments when modal opens to reset state
    const [sessionKey, setSessionKey] = useState(0);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<CharacterRole | null>(null);
    // ROK-452: Track multiple preferred roles
    const [selectedRoles, setSelectedRoles] = useState<CharacterRole[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);

    // Reset selection when modal opens (increment session key)
    useEffect(() => {
        if (isOpen) {
            setSessionKey((k) => k + 1);
        }
    }, [isOpen]);

    // Derive initial selection from main character when session key changes
    const defaultCharacterId = useMemo(() => mainCharacter?.id ?? null, [mainCharacter?.id]);

    useEffect(() => {
        setSelectedCharacterId(defaultCharacterId);
        setShowCreateForm(false);
        // Pre-select role: use prop if provided, else character's effective role, else null
        if (preSelectedRole) {
            setSelectedRole(preSelectedRole);
            setSelectedRoles([preSelectedRole]);
        } else {
            const defaultChar = characters.find((c) => c.id === defaultCharacterId);
            const defaultRole = (defaultChar?.effectiveRole as CharacterRole) ?? null;
            setSelectedRole(defaultRole);
            setSelectedRoles(defaultRole ? [defaultRole] : []);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    // Auto-select main character when characters load after modal is already open
    useEffect(() => {
        if (defaultCharacterId && !selectedCharacterId) {
            setSelectedCharacterId(defaultCharacterId);
            if (!preSelectedRole) {
                const defaultChar = characters.find((c) => c.id === defaultCharacterId);
                const defaultRole = (defaultChar?.effectiveRole as CharacterRole) ?? null;
                setSelectedRole(defaultRole);
                setSelectedRoles(defaultRole ? [defaultRole] : []);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultCharacterId]);

    const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);

    // When character selection changes, update role to character's default (unless pre-selected)
    const handleSelectCharacter = (characterId: string) => {
        setSelectedCharacterId(characterId);
        if (!preSelectedRole) {
            const char = characters.find((c) => c.id === characterId);
            if (char?.effectiveRole) {
                const role = char.effectiveRole as CharacterRole;
                setSelectedRole(role);
                setSelectedRoles([role]);
            }
        }
    };

    const handleConfirm = () => {
        if (!selectedCharacterId) return;
        onConfirm({
            characterId: selectedCharacterId,
            role: hasRoles ? (selectedRole ?? undefined) : undefined,
            // ROK-452: Include all preferred roles for multi-role signup
            preferredRoles: hasRoles && selectedRoles.length > 0 ? selectedRoles : undefined,
        });
    };

    const handleCharacterCreated = (character?: CharacterDto) => {
        setShowCreateForm(false);
        // If we got a character back, select it
        if (character?.id) {
            setSelectedCharacterId(character.id);
            if (character.effectiveRole && !preSelectedRole) {
                const role = character.effectiveRole as CharacterRole;
                setSelectedRole(role);
                setSelectedRoles([role]);
            }
        }
        // Characters list will refresh via query invalidation
    };

    const content = (
        <div className="space-y-4">
            {/* Loading state */}
            {isLoadingCharacters && (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-16 bg-panel rounded-lg animate-pulse"
                        />
                    ))}
                </div>
            )}

            {/* Error state */}
            {isError && (
                <div className="text-center py-8 text-red-400">
                    <p className="mb-2">Failed to load characters</p>
                    <p className="text-sm text-muted">
                        {error instanceof Error ? error.message : 'Please try again.'}
                    </p>
                </div>
            )}

            {/* No characters state — sign up instantly or create one (ROK-439/234) */}
            {!isLoadingCharacters && !isError && characters.length === 0 && !showCreateForm && (
                <div className="space-y-4">
                    <p className="text-center text-muted">
                        No characters found{gameName ? ` for ${gameName}` : ' for this game'}.
                    </p>

                    {/* ROK-529: Show role picker even without characters for MMO events */}
                    {hasRoles && (
                        <div>
                            <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                                Preferred Roles
                                <span className="ml-1 text-muted font-normal normal-case">(select all you can play)</span>
                            </h3>
                            <div className="flex gap-2">
                                {ROLES.map((role) => {
                                    const isSelected = selectedRoles.includes(role);
                                    return (
                                        <button
                                            key={role}
                                            onClick={() => {
                                                let next: CharacterRole[];
                                                if (isSelected) {
                                                    next = selectedRoles.filter((r) => r !== role);
                                                } else {
                                                    next = [...selectedRoles, role];
                                                }
                                                setSelectedRoles(next);
                                                setSelectedRole(next[0] ?? null);
                                            }}
                                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium ${
                                                isSelected
                                                    ? `${ROLE_COLORS[role]} border-current`
                                                    : 'border-edge bg-panel/50 text-muted hover:border-edge-strong hover:bg-panel'
                                            }`}
                                        >
                                            <RoleIcon role={role} size="w-5 h-5" />
                                            <span>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedRoles.length > 1 && (
                                <p className="text-xs text-emerald-400/80 mt-1.5">
                                    You'll be auto-assigned to the best available slot.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={() => onSkip(hasRoles && selectedRoles.length > 0 ? { preferredRoles: selectedRoles } : undefined)}
                            disabled={isConfirming}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground font-medium rounded-lg transition-colors"
                        >
                            {isConfirming ? 'Signing up...' : 'Sign Up Without Character'}
                        </button>
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="px-4 py-2 bg-panel hover:bg-overlay text-foreground font-medium rounded-lg transition-colors"
                        >
                            Create Character First
                        </button>
                    </div>
                </div>
            )}

            {/* Inline character creation form (ROK-234) */}
            {showCreateForm && gameId && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        Create a Character
                    </h3>
                    <InlineCharacterForm
                        gameId={gameId}
                        hasRoles={hasRoles}
                        gameSlug={gameSlug}
                        onCharacterCreated={handleCharacterCreated}
                        onCancel={() => setShowCreateForm(false)}
                    />
                </div>
            )}

            {/* Main character section */}
            {mainCharacter && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        Main Character
                    </h3>
                    <CharacterCard
                        character={mainCharacter}
                        isSelected={selectedCharacterId === mainCharacter.id}
                        onSelect={() => handleSelectCharacter(mainCharacter.id)}
                        isMain
                    />
                </div>
            )}

            {/* Alt characters section */}
            {altCharacters.length > 0 && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        Alt Characters
                    </h3>
                    <div className="space-y-2">
                        {altCharacters.map((character) => (
                            <CharacterCard
                                key={character.id}
                                character={character}
                                isSelected={selectedCharacterId === character.id}
                                onSelect={() => handleSelectCharacter(character.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Add another character link (ROK-234) */}
            {characters.length > 0 && !showCreateForm && gameId && (
                <button
                    onClick={() => setShowCreateForm(true)}
                    className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                    + Add another character
                </button>
            )}

            {/* Inline create form when characters already exist */}
            {characters.length > 0 && showCreateForm && gameId && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        Add Character
                    </h3>
                    <InlineCharacterForm
                        gameId={gameId}
                        hasRoles={hasRoles}
                        gameSlug={gameSlug}
                        onCharacterCreated={handleCharacterCreated}
                        onCancel={() => setShowCreateForm(false)}
                    />
                </div>
            )}

            {/* ROK-452: Multi-role picker for MMO events */}
            {hasRoles && characters.length > 0 && !showCreateForm && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        Preferred Roles
                        <span className="ml-1 text-muted font-normal normal-case">(select all you can play)</span>
                    </h3>
                    <div className="flex gap-2">
                        {ROLES.map((role) => {
                            const isSelected = selectedRoles.includes(role);
                            return (
                                <button
                                    key={role}
                                    onClick={() => {
                                        let next: CharacterRole[];
                                        if (isSelected) {
                                            next = selectedRoles.filter((r) => r !== role);
                                        } else {
                                            next = [...selectedRoles, role];
                                        }
                                        setSelectedRoles(next);
                                        // Keep selectedRole in sync: primary is first selected, or null
                                        setSelectedRole(next[0] ?? null);
                                    }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium ${
                                        isSelected
                                            ? `${ROLE_COLORS[role]} border-current`
                                            : 'border-edge bg-panel/50 text-muted hover:border-edge-strong hover:bg-panel'
                                    }`}
                                >
                                    <RoleIcon role={role} size="w-5 h-5" />
                                    <span>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
                                </button>
                            );
                        })}
                    </div>
                    {selectedRoles.length > 1 && (
                        <p className="text-xs text-emerald-400/80 mt-1.5">
                            You'll be auto-assigned to the best available slot.
                        </p>
                    )}
                    {/* Show mismatch warning when primary role differs from character's default */}
                    {selectedCharacter?.effectiveRole && selectedRole && selectedCharacter.effectiveRole !== selectedRole && selectedRoles.length === 1 && (
                        <p className="text-xs text-amber-400/80 mt-1.5">
                            This character's default role is {selectedCharacter.effectiveRole}. Signing up as {selectedRole} instead.
                        </p>
                    )}
                </div>
            )}

            {/* Actions — only shown when characters exist and form is not active */}
            {characters.length > 0 && !showCreateForm && (
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedCharacterId || isConfirming || (hasRoles && selectedRoles.length === 0)}
                        className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors font-medium"
                    >
                        {isConfirming ? 'Signing up...' : 'Sign Up'}
                    </button>
                </div>
            )}
        </div>
    );

    const title = 'Select Character' + (hasRoles ? ' & Role' : '');

    // ROK-335: Use BottomSheet on mobile, Modal on desktop
    if (isMobile) {
        return (
            <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
                {content}
            </BottomSheet>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            {content}
        </Modal>
    );
}

interface CharacterCardProps {
    character: CharacterDto;
    isSelected: boolean;
    onSelect: () => void;
    isMain?: boolean;
}

/**
 * Character selection card within the modal.
 */
function CharacterCard({ character, isSelected, onSelect, isMain }: CharacterCardProps) {
    const role = character.effectiveRole as CharacterRole | null;

    return (
        <button
            onClick={onSelect}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${isSelected
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-edge bg-panel/50 hover:border-edge-strong hover:bg-panel'
                }`}
        >
            {/* Avatar or placeholder */}
            {character.avatarUrl ? (
                <img
                    src={character.avatarUrl}
                    alt={character.name}
                    className="w-10 h-10 rounded-full bg-overlay"
                />
            ) : (
                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-lg">
                    {character.name.charAt(0).toUpperCase()}
                </div>
            )}

            {/* Character info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                        {character.name}
                    </span>
                    {isMain && (
                        <span className="text-yellow-400 text-sm" title="Main Character">
                            ⭐
                        </span>
                    )}
                    {character.faction && (
                        <span className={`px-1 py-0.5 rounded text-xs ${character.faction === 'horde' ? 'text-red-400' : 'text-blue-400'
                            }`}>
                            {character.faction === 'horde' ? 'H' : 'A'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted truncate">
                    {character.level && <span className="shrink-0">Lv.{character.level}</span>}
                    {character.level && character.class && <span className="shrink-0">·</span>}
                    {character.class && <span className="truncate">{character.class}</span>}
                    {character.spec && (
                        <>
                            <span className="shrink-0">·</span>
                            <span className="truncate">{character.spec}</span>
                        </>
                    )}
                    {character.itemLevel && (
                        <>
                            <span className="shrink-0">·</span>
                            <span className="shrink-0 text-purple-400">{character.itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>

            {/* Role badge */}
            {role && (
                <span
                    className={`shrink-0 px-2 py-1 text-xs font-medium rounded border whitespace-nowrap ${ROLE_COLORS[role]}`}
                >
                    <RoleIcon role={role} size="w-3.5 h-3.5" /> {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
            )}

            {/* Selection indicator */}
            {isSelected && (
                <div className="shrink-0 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <svg
                        className="w-3 h-3 text-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>
            )}
        </button>
    );
}
