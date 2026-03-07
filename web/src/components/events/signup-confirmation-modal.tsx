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

function resolveDefaultRole(characters: CharacterDto[], charId: string | null, preSelectedRole?: CharacterRole) {
    if (preSelectedRole) return { role: preSelectedRole, roles: [preSelectedRole] };
    const defaultChar = characters.find((c) => c.id === charId);
    const role = (defaultChar?.effectiveRole as CharacterRole) ?? null;
    return { role, roles: role ? [role] : [] };
}

function useSignupSelectionReset(
    sessionKey: number, defaultCharacterId: string | null, characters: CharacterDto[], preSelectedRole: CharacterRole | undefined,
    setSelectedCharacterId: React.Dispatch<React.SetStateAction<string | null>>, setSelectedRole: (v: CharacterRole | null) => void,
    setSelectedRoles: (v: CharacterRole[]) => void, setShowCreateForm: (v: boolean) => void,
) {
    useEffect(() => {
        setSelectedCharacterId(defaultCharacterId);
        setShowCreateForm(false);
        const { role, roles } = resolveDefaultRole(characters, defaultCharacterId, preSelectedRole);
        setSelectedRole(role); setSelectedRoles(roles);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    useEffect(() => {
        if (!defaultCharacterId) return;
        setSelectedCharacterId((prev) => {
            if (prev) return prev;
            const { role, roles } = resolveDefaultRole(characters, defaultCharacterId, preSelectedRole);
            setSelectedRole(role); setSelectedRoles(roles);
            return defaultCharacterId;
        });
    }, [defaultCharacterId, preSelectedRole, characters, setSelectedCharacterId, setSelectedRole, setSelectedRoles]);
}

function useSignupSelection(isOpen: boolean, characters: CharacterDto[], preSelectedRole?: CharacterRole) {
    const mainCharacter = characters.find((c) => c.isMain);
    const [sessionKey, setSessionKey] = useState(0);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<CharacterRole | null>(null);
    const [selectedRoles, setSelectedRoles] = useState<CharacterRole[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    if (isOpen && !prevIsOpen) { setPrevIsOpen(true); setSessionKey((k) => k + 1); }
    if (!isOpen && prevIsOpen) { setPrevIsOpen(false); }
    const defaultCharacterId = useMemo(() => mainCharacter?.id ?? null, [mainCharacter?.id]);
    useSignupSelectionReset(sessionKey, defaultCharacterId, characters, preSelectedRole, setSelectedCharacterId, setSelectedRole, setSelectedRoles, setShowCreateForm);

    return {
        selectedCharacterId, setSelectedCharacterId,
        selectedRole, setSelectedRole,
        selectedRoles, setSelectedRoles,
        showCreateForm, setShowCreateForm,
    };
}

function handleCharacterSelect(
    characterId: string, characters: CharacterDto[], preSelectedRole: CharacterRole | undefined,
    setSelectedCharacterId: (v: string | null) => void,
    setSelectedRole: (v: CharacterRole | null) => void,
    setSelectedRoles: (v: CharacterRole[]) => void,
) {
    setSelectedCharacterId(characterId);
    if (!preSelectedRole) {
        const char = characters.find((c) => c.id === characterId);
        const role = (char?.effectiveRole as CharacterRole) ?? null;
        setSelectedRole(role); setSelectedRoles(role ? [role] : []);
    }
}

function CharacterListSection({ characters, selectedCharacterId, onSelect }: {
    characters: CharacterDto[]; selectedCharacterId: string | null;
    onSelect: (id: string) => void;
}) {
    const mainCharacter = characters.find((c) => c.isMain);
    const altCharacters = characters.filter((c) => !c.isMain);

    return (
        <>
            {mainCharacter && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">Main Character</h3>
                    <SignupCharacterCard character={mainCharacter} isSelected={selectedCharacterId === mainCharacter.id}
                        onSelect={() => onSelect(mainCharacter.id)} isMain />
                </div>
            )}
            {altCharacters.length > 0 && (
                <div>
                    <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">Alt Characters</h3>
                    <div className="space-y-2">
                        {altCharacters.map((character) => (
                            <SignupCharacterCard key={character.id} character={character}
                                isSelected={selectedCharacterId === character.id} onSelect={() => onSelect(character.id)} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

function ConfirmButtons({ onClose, onConfirm, disabled, isConfirming, hasRoles, selectedRoles }: {
    onClose: () => void; onConfirm: () => void; disabled: boolean;
    isConfirming: boolean; hasRoles: boolean; selectedRoles: CharacterRole[];
}) {
    return (
        <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors">Cancel</button>
            <button onClick={onConfirm} disabled={disabled || isConfirming || (hasRoles && selectedRoles.length === 0)}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-overlay disabled:text-dim text-foreground rounded-lg transition-colors font-medium">
                {isConfirming ? 'Signing up...' : 'Sign Up'}
            </button>
        </div>
    );
}

function useSignupModalHandlers(sel: ReturnType<typeof useSignupSelection>, hasRoles: boolean, preSelectedRole?: CharacterRole) {
    const handleToggleRole = (role: CharacterRole) => {
        const isSelected = sel.selectedRoles.includes(role);
        const next = isSelected ? sel.selectedRoles.filter((r) => r !== role) : [...sel.selectedRoles, role];
        sel.setSelectedRoles(next); sel.setSelectedRole(next[0] ?? null);
    };

    const handleCharacterCreated = (character?: CharacterDto) => {
        sel.setShowCreateForm(false);
        if (character?.id) {
            sel.setSelectedCharacterId(character.id);
            if (character.effectiveRole && !preSelectedRole) {
                const role = character.effectiveRole as CharacterRole;
                sel.setSelectedRole(role); sel.setSelectedRoles([role]);
            }
        }
    };

    const buildConfirmPayload = () => {
        if (!sel.selectedCharacterId) return null;
        return {
            characterId: sel.selectedCharacterId,
            role: hasRoles ? (sel.selectedRole ?? undefined) : undefined,
            preferredRoles: hasRoles && sel.selectedRoles.length > 0 ? sel.selectedRoles : undefined,
        };
    };

    return { handleToggleRole, handleCharacterCreated, buildConfirmPayload };
}

export function SignupConfirmationModal({
    isOpen, onClose, onConfirm, onSkip, isConfirming = false,
    gameId, gameName, hasRoles = true, gameSlug, preSelectedRole, eventId,
}: SignupConfirmationModalProps) {
    const { data: charactersData, isLoading: isLoadingCharacters, isError, error } = useMyCharacters(gameId, isOpen);
    const isMobile = useMediaQuery('(max-width: 767px)');
    const characters = charactersData?.data ?? [];
    const sel = useSignupSelection(isOpen, characters, preSelectedRole);
    const { handleToggleRole, handleCharacterCreated, buildConfirmPayload } = useSignupModalHandlers(sel, hasRoles, preSelectedRole);
    const handleConfirm = () => { const payload = buildConfirmPayload(); if (payload) onConfirm(payload); };

    const title = 'Select Character' + (hasRoles ? ' & Role' : '');
    const content = (
        <SignupModalContent isLoadingCharacters={isLoadingCharacters} isError={isError} error={error}
            characters={characters} sel={sel} gameId={gameId} gameName={gameName} hasRoles={hasRoles}
            gameSlug={gameSlug} preSelectedRole={preSelectedRole} eventId={eventId} isConfirming={isConfirming}
            onClose={onClose} onSkip={onSkip} handleToggleRole={handleToggleRole}
            handleCharacterCreated={handleCharacterCreated} handleConfirm={handleConfirm} />
    );

    if (isMobile) return <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>{content}</BottomSheet>;
    return <Modal isOpen={isOpen} onClose={onClose} title={title}>{content}</Modal>;
}

function InlineCreateSection({ gameId, characters, hasRoles, gameSlug, eventId, sel, handleCharacterCreated }: {
    gameId?: number; characters: CharacterDto[]; hasRoles: boolean; gameSlug?: string; eventId?: number;
    sel: ReturnType<typeof useSignupSelection>; handleCharacterCreated: (c?: CharacterDto) => void;
}) {
    if (!sel.showCreateForm || !gameId) return null;
    return (
        <div>
            <h3 className="text-xs font-medium text-dim uppercase tracking-wide mb-2">{characters.length > 0 ? 'Add Character' : 'Create a Character'}</h3>
            <InlineCharacterForm gameId={gameId} hasRoles={hasRoles} gameSlug={gameSlug} eventId={eventId}
                onCharacterCreated={handleCharacterCreated} onCancel={() => sel.setShowCreateForm(false)} />
        </div>
    );
}

function SignupRolePickerSection({ characters, sel, hasRoles, handleToggleRole }: {
    characters: CharacterDto[]; sel: ReturnType<typeof useSignupSelection>; hasRoles: boolean; handleToggleRole: (r: CharacterRole) => void;
}) {
    if (!hasRoles || characters.length === 0 || sel.showCreateForm) return null;
    const selectedCharacter = characters.find((c) => c.id === sel.selectedCharacterId);
    return (
        <RolePicker selectedRoles={sel.selectedRoles} onToggleRole={handleToggleRole}
            showMismatchWarning={!!selectedCharacter?.effectiveRole && !!sel.selectedRole && selectedCharacter.effectiveRole !== sel.selectedRole}
            mismatchDefaultRole={selectedCharacter?.effectiveRole ?? null}
            mismatchSelectedRole={sel.selectedRole} />
    );
}

function EmptyCharactersPrompt({ characters, isLoadingCharacters, isError, sel, gameName, hasRoles, isConfirming, handleToggleRole, onSkip }: {
    characters: CharacterDto[]; isLoadingCharacters: boolean; isError: boolean;
    sel: ReturnType<typeof useSignupSelection>; gameName?: string; hasRoles: boolean; isConfirming: boolean;
    handleToggleRole: (r: CharacterRole) => void; onSkip: (o?: { preferredRoles?: CharacterRole[] }) => void;
}) {
    if (isLoadingCharacters || isError || characters.length > 0 || sel.showCreateForm) return null;
    return (
        <NoCharactersState gameName={gameName} hasRoles={hasRoles} selectedRoles={sel.selectedRoles}
            onToggleRole={handleToggleRole} isConfirming={isConfirming}
            onSkip={() => onSkip(hasRoles && sel.selectedRoles.length > 0 ? { preferredRoles: sel.selectedRoles } : undefined)}
            onCreateClick={() => sel.setShowCreateForm(true)} />
    );
}

function SignupModalContent({ isLoadingCharacters, isError, error, characters, sel, gameId, gameName, hasRoles, gameSlug, preSelectedRole, eventId, isConfirming, onClose, onSkip, handleToggleRole, handleCharacterCreated, handleConfirm }: {
    isLoadingCharacters: boolean; isError: boolean; error: unknown; characters: CharacterDto[];
    sel: ReturnType<typeof useSignupSelection>; gameId?: number; gameName?: string; hasRoles: boolean;
    gameSlug?: string; preSelectedRole?: CharacterRole; eventId?: number; isConfirming: boolean;
    onClose: () => void; onSkip: (o?: { preferredRoles?: CharacterRole[] }) => void;
    handleToggleRole: (r: CharacterRole) => void; handleCharacterCreated: (c?: CharacterDto) => void; handleConfirm: () => void;
}) {
    return (
        <div className="space-y-4">
            {isLoadingCharacters && <LoadingSkeleton />}
            {isError && <ErrorState error={error} />}
            <EmptyCharactersPrompt characters={characters} isLoadingCharacters={isLoadingCharacters} isError={isError}
                sel={sel} gameName={gameName} hasRoles={hasRoles} isConfirming={isConfirming} handleToggleRole={handleToggleRole} onSkip={onSkip} />
            <InlineCreateSection gameId={gameId} characters={characters} hasRoles={hasRoles} gameSlug={gameSlug}
                eventId={eventId} sel={sel} handleCharacterCreated={handleCharacterCreated} />
            <CharacterListSection characters={characters} selectedCharacterId={sel.selectedCharacterId}
                onSelect={(id) => handleCharacterSelect(id, characters, preSelectedRole, sel.setSelectedCharacterId, sel.setSelectedRole, sel.setSelectedRoles)} />
            {characters.length > 0 && !sel.showCreateForm && gameId && (
                <button onClick={() => sel.setShowCreateForm(true)} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">+ Add another character</button>
            )}
            <SignupRolePickerSection characters={characters} sel={sel} hasRoles={hasRoles} handleToggleRole={handleToggleRole} />
            {characters.length > 0 && !sel.showCreateForm && (
                <ConfirmButtons onClose={onClose} onConfirm={handleConfirm}
                    disabled={!sel.selectedCharacterId} isConfirming={isConfirming}
                    hasRoles={hasRoles} selectedRoles={sel.selectedRoles} />
            )}
        </div>
    );
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
