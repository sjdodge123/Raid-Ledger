import { useState, useEffect, useMemo } from 'react';
import type { CharacterDto, CharacterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useMyCharacters } from '../../hooks/use-characters';
import { useConfirmSignup } from '../../hooks/use-signups';
import { toast } from 'sonner';

interface SignupConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    signupId: number;
    gameId?: string;
    /** The expected role for this event (e.g., 'tank', 'healer', 'dps') */
    expectedRole?: CharacterRole;
}

/** Role display colors */
const ROLE_COLORS: Record<CharacterRole, string> = {
    tank: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    healer: 'bg-green-500/20 text-green-400 border-green-500/30',
    dps: 'bg-red-500/20 text-red-400 border-red-500/30',
};

/** Role emoji indicators */
const ROLE_ICONS: Record<CharacterRole, string> = {
    tank: '🛡️',
    healer: '💚',
    dps: '⚔️',
};

/**
 * Modal for confirming which character a user is bringing to an event.
 * Implements ROK-131 AC-2, AC-3, AC-4, AC-5.
 */
export function SignupConfirmationModal({
    isOpen,
    onClose,
    eventId,
    signupId,
    gameId,
    expectedRole,
}: SignupConfirmationModalProps) {
    const { data: charactersData, isLoading: isLoadingCharacters, isError, error } = useMyCharacters(gameId, isOpen);
    const confirmMutation = useConfirmSignup(eventId);

    const characters = charactersData?.data ?? [];
    const mainCharacter = characters.find((c) => c.isMain);
    const altCharacters = characters.filter((c) => !c.isMain);

    // Track a "session key" that increments when modal opens to reset state
    const [sessionKey, setSessionKey] = useState(0);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

    // Reset selection when modal opens (increment session key)
    useEffect(() => {
        if (isOpen) {
            setSessionKey((k) => k + 1);
        }
    }, [isOpen]);

    // Derive initial selection from main character when session key changes
    // This uses useMemo to compute the default, then applies it via effect
    const defaultCharacterId = useMemo(() => mainCharacter?.id ?? null, [mainCharacter?.id]);

    useEffect(() => {
        // Apply default selection when session starts (sessionKey changes)
        setSelectedCharacterId(defaultCharacterId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);


    // Check if selected character role mismatches expected role (AC-5)
    const hasRoleMismatch =
        expectedRole &&
        selectedCharacter?.role &&
        selectedCharacter.role !== expectedRole;

    const handleConfirm = async () => {
        if (!selectedCharacterId) return;

        try {
            await confirmMutation.mutateAsync({
                signupId,
                characterId: selectedCharacterId,
            });
            toast.success('Character confirmed!');
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to confirm character');
        }
    };

    const handleSelectCharacter = (characterId: string) => {
        setSelectedCharacterId(characterId);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Confirm Your Character">
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

                {/* No characters state */}
                {!isLoadingCharacters && !isError && characters.length === 0 && (
                    <div className="text-center py-8 text-muted">
                        <p className="mb-2">No characters found for this game.</p>
                        <p className="text-sm">
                            Add characters in your profile to confirm signups.
                        </p>
                    </div>
                )}

                {/* Main character section (AC-3) */}
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

                {/* Alt characters section (AC-4) */}
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

                {/* Role mismatch warning (AC-5) */}
                {hasRoleMismatch && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
                        <span className="text-lg">⚠️</span>
                        <div className="text-sm">
                            <p className="font-medium">Role Mismatch</p>
                            <p className="text-amber-400/80">
                                This character's role ({selectedCharacter?.role}) differs from
                                the expected role ({expectedRole}). This may affect raid
                                composition.
                            </p>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedCharacterId || confirmMutation.isPending}
                        className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors font-medium"
                    >
                        {confirmMutation.isPending ? 'Confirming...' : 'Confirm'}
                    </button>
                </div>
            </div>
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
    const role = character.role as CharacterRole | null;

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
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                    {character.class && <span>{character.class}</span>}
                    {character.spec && (
                        <>
                            <span>·</span>
                            <span>{character.spec}</span>
                        </>
                    )}
                    {character.itemLevel && (
                        <>
                            <span>·</span>
                            <span className="text-purple-400">{character.itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>

            {/* Role badge */}
            {role && (
                <span
                    className={`px-2 py-1 text-xs font-medium rounded border ${ROLE_COLORS[role]}`}
                >
                    {ROLE_ICONS[role]} {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
            )}

            {/* Selection indicator */}
            {isSelected && (
                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
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
