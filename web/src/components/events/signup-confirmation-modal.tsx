import { useState, useEffect, useMemo } from 'react';
import type { CharacterDto, CharacterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { BottomSheet } from '../ui/bottom-sheet';
import { useMyCharacters } from '../../hooks/use-characters';
import { InlineCharacterForm } from '../characters/inline-character-form';
import { useMediaQuery } from '../../hooks/use-media-query';
import { RolePicker } from './signup-role-picker';
import { SignupCharacterCard } from './SignupCharacterCard';

interface SignupConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }) => void;
    onSkip: (options?: { preferredRoles?: CharacterRole[] }) => void;
    isConfirming?: boolean;
    gameId?: number;
    gameName?: string;
    hasRoles?: boolean;
    gameSlug?: string;
    preSelectedRole?: CharacterRole;
    eventId?: number;
}

export function SignupConfirmationModal({
    isOpen, onClose, onConfirm, onSkip, isConfirming = false,
    gameId, gameName, hasRoles = true, gameSlug, preSelectedRole, eventId,
}: SignupConfirmationModalProps) {
    const { data: charactersData, isLoading: isLoadingCharacters, isError, error } = useMyCharacters(gameId, isOpen);
    const isMobile = useMediaQuery('(max-width: 767px)');
    const characters = charactersData?.data ?? [];
    const mainCharacter = characters.find((c) => c.isMain);
    const altCharacters = characters.filter((c) => !c.isMain);

    const [sessionKey, setSessionKey] = useState(0);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<CharacterRole | null>(null);
    const [selectedRoles, setSelectedRoles] = useState<CharacterRole[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);

    useEffect(() => { if (isOpen) setSessionKey((k) => k + 1); }, [isOpen]);

    const defaultCharacterId = useMemo(() => mainCharacter?.id ?? null, [mainCharacter?.id]);

    useEffect(() => {
        setSelectedCharacterId(defaultCharacterId);
        setShowCreateForm(false);
        if (preSelectedRole) { setSelectedRole(preSelectedRole); setSelectedRoles([preSelectedRole]); }
        else {
            const defaultChar = characters.find((c) => c.id === defaultCharacterId);
            const defaultRole = (defaultChar?.effectiveRole as CharacterRole) ?? null;
            setSelectedRole(defaultRole); setSelectedRoles(defaultRole ? [defaultRole] : []);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    useEffect(() => {
        if (!defaultCharacterId) return;
        setSelectedCharacterId((prev) => {
            if (prev) return prev;
            if (!preSelectedRole) {
                const defaultChar = characters.find((c) => c.id === defaultCharacterId);
                const defaultRole = (defaultChar?.effectiveRole as CharacterRole) ?? null;
                setSelectedRole(defaultRole); setSelectedRoles(defaultRole ? [defaultRole] : []);
            }
            return defaultCharacterId;
        });
    }, [defaultCharacterId, preSelectedRole, characters]);

    const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);

    const handleSelectCharacter = (characterId: string) => {
        setSelectedCharacterId(characterId);
        if (!preSelectedRole) {
            const char = characters.find((c) => c.id === characterId);
            const role = (char?.effectiveRole as CharacterRole) ?? null;
            setSelectedRole(role); setSelectedRoles(role ? [role] : []);
        }
    };

    const handleToggleRole = (role: CharacterRole) => {
        const isSelected = selectedRoles.includes(role);
        const next = isSelected ? selectedRoles.filter((r) => r !== role) : [...selectedRoles, role];
        setSelectedRoles(next); setSelectedRole(next[0] ?? null);
    };

    const handleConfirm = () => {
        if (!selectedCharacterId) return;
        onConfirm({
            characterId: selectedCharacterId,
            role: hasRoles ? (selectedRole ?? undefined) : undefined,
            preferredRoles: hasRoles && selectedRoles.length > 0 ? selectedRoles : undefined,
        });
    };

    const handleCharacterCreated = (character?: CharacterDto) => {
        setShowCreateForm(false);
        if (character?.id) {
            setSelectedCharacterId(character.id);
            if (character.effectiveRole && !preSelectedRole) {
                const role = character.effectiveRole as CharacterRole;
                setSelectedRole(role); setSelectedRoles([role]);
            }
        }
    };

    const content = (
        <div className="space-y-4">
            {isLoadingCharacters && <LoadingSkeleton />}
            {isError && <ErrorState error={error} />}

            {/* No characters state */}
            {!isLoadingCharacters && !isError && characters.length === 0 && !showCreateForm && (
                <NoCharactersState
                    gameName={gameName} hasRoles={hasRoles} selectedRoles={selectedRoles}
                    onToggleRole={handleToggleRole} isConfirming={isConfirming}
                    onSkip={() => onSkip(hasRoles && selectedRoles.length > 0 ? { preferredRoles: selectedRoles } : undefined)}
                    onCreateClick={() => setShowCreateForm(true)}
                />
            )}

            {/* Inline character creation form */}
            {showCreateForm && gameId && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">
                        {characters.length > 0 ? 'Add Character' : 'Create a Character'}
                    </h3>
                    <InlineCharacterForm gameId={gameId} hasRoles={hasRoles} gameSlug={gameSlug} eventId={eventId} onCharacterCreated={handleCharacterCreated} onCancel={() => setShowCreateForm(false)} />
                </div>
            )}

            {mainCharacter && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">Main Character</h3>
                    <SignupCharacterCard character={mainCharacter} isSelected={selectedCharacterId === mainCharacter.id} onSelect={() => handleSelectCharacter(mainCharacter.id)} isMain />
                </div>
            )}

            {altCharacters.length > 0 && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">Alt Characters</h3>
                    <div className="space-y-2">
                        {altCharacters.map((character) => (
                            <SignupCharacterCard key={character.id} character={character} isSelected={selectedCharacterId === character.id} onSelect={() => handleSelectCharacter(character.id)} />
                        ))}
                    </div>
                </div>
            )}

            {characters.length > 0 && !showCreateForm && gameId && (
                <button onClick={() => setShowCreateForm(true)} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">+ Add another character</button>
            )}

            {hasRoles && characters.length > 0 && !showCreateForm && (
                <RolePicker
                    selectedRoles={selectedRoles} onToggleRole={handleToggleRole}
                    showMismatchWarning={!!selectedCharacter?.effectiveRole && !!selectedRole && selectedCharacter.effectiveRole !== selectedRole}
                    mismatchDefaultRole={selectedCharacter?.effectiveRole ?? null}
                    mismatchSelectedRole={selectedRole}
                />
            )}

            {characters.length > 0 && !showCreateForm && (
                <div className="flex gap-3 pt-2">
                    <button onClick={onClose} className="flex-1 px-4 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleConfirm} disabled={!selectedCharacterId || isConfirming || (hasRoles && selectedRoles.length === 0)} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors font-medium">
                        {isConfirming ? 'Signing up...' : 'Sign Up'}
                    </button>
                </div>
            )}
        </div>
    );

    const title = 'Select Character' + (hasRoles ? ' & Role' : '');

    if (isMobile) return <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>{content}</BottomSheet>;
    return <Modal isOpen={isOpen} onClose={onClose} title={title}>{content}</Modal>;
}

function LoadingSkeleton() {
    return (
        <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-panel rounded-lg animate-pulse" />)}
        </div>
    );
}

function ErrorState({ error }: { error: unknown }) {
    return (
        <div className="text-center py-8 text-red-400">
            <p className="mb-2">Failed to load characters</p>
            <p className="text-sm text-muted">{error instanceof Error ? error.message : 'Please try again.'}</p>
        </div>
    );
}

function NoCharactersState({ gameName, hasRoles, selectedRoles, onToggleRole, isConfirming, onSkip, onCreateClick }: {
    gameName?: string; hasRoles: boolean; selectedRoles: CharacterRole[];
    onToggleRole: (role: CharacterRole) => void; isConfirming: boolean;
    onSkip: () => void; onCreateClick: () => void;
}) {
    return (
        <div className="space-y-4">
            <p className="text-center text-muted">No characters found{gameName ? ` for ${gameName}` : ' for this game'}.</p>
            {hasRoles && <RolePicker selectedRoles={selectedRoles} onToggleRole={onToggleRole} />}
            <div className="flex flex-col gap-2">
                <button onClick={onSkip} disabled={isConfirming} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground font-medium rounded-lg transition-colors">
                    {isConfirming ? 'Signing up...' : 'Sign Up Without Character'}
                </button>
                <button onClick={onCreateClick} className="px-4 py-2 bg-panel hover:bg-overlay text-foreground font-medium rounded-lg transition-colors">Create Character First</button>
            </div>
        </div>
    );
}
