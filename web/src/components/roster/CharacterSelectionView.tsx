import type { RosterAssignmentResponse, CharacterDto, RosterRole } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { PlayerCard } from '../events/player-card';
import { SelectableCharacterCard } from './SelectableCharacterCard';

interface CharacterSelectionViewProps {
    isOpen: boolean;
    title: string;
    selectionTarget: RosterAssignmentResponse;
    characters: CharacterDto[];
    isLoadingCharacters: boolean;
    selectedCharacterId: string | null;
    slotRole: RosterRole | null;
    onSelectCharacter: (charId: string, role?: RosterRole) => void;
    onConfirm: () => void;
    onSkip: () => void;
    onBack: () => void;
    onClose: () => void;
}

export function CharacterSelectionView({
    isOpen, title, selectionTarget, characters,
    isLoadingCharacters, selectedCharacterId, slotRole,
    onSelectCharacter, onConfirm, onSkip, onBack, onClose,
}: CharacterSelectionViewProps) {
    const mainCharacter = characters.find((c) => c.isMain);
    const altCharacters = characters.filter((c) => !c.isMain);
    const hasCharacters = characters.length > 0;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="assignment-popup">
                <button onClick={onBack} className="assignment-popup__back-btn">
                    &larr; Back to players
                </button>
                <PlayerCard player={selectionTarget} size="default" />
                {isLoadingCharacters && <LoadingSkeleton />}
                {!isLoadingCharacters && !hasCharacters && (
                    <NoCharactersState onSkip={onSkip} />
                )}
                {!isLoadingCharacters && hasCharacters && (
                    <CharacterPicker
                        mainCharacter={mainCharacter}
                        altCharacters={altCharacters}
                        selectedCharacterId={selectedCharacterId}
                        slotRole={slotRole}
                        onSelectCharacter={onSelectCharacter}
                        onConfirm={onConfirm}
                        onSkip={onSkip}
                    />
                )}
            </div>
        </Modal>
    );
}

function LoadingSkeleton() {
    return (
        <div className="space-y-3 mt-3">
            {[1, 2].map((i) => (
                <div key={i} className="h-14 bg-panel rounded-lg animate-pulse" />
            ))}
        </div>
    );
}

function NoCharactersState({ onSkip }: { onSkip: () => void }) {
    return (
        <div className="assignment-popup__section">
            <p className="text-sm text-muted text-center py-3">
                This player has no characters for this game.
            </p>
            <button onClick={onSkip} className="btn btn-primary btn-sm w-full">
                Assign Without Character
            </button>
        </div>
    );
}

function CharacterPicker({
    mainCharacter, altCharacters, selectedCharacterId, slotRole,
    onSelectCharacter, onConfirm, onSkip,
}: {
    mainCharacter?: CharacterDto;
    altCharacters: CharacterDto[];
    selectedCharacterId: string | null;
    slotRole: RosterRole | null;
    onSelectCharacter: (charId: string, role?: RosterRole) => void;
    onConfirm: () => void;
    onSkip: () => void;
}) {
    return (
        <>
            {mainCharacter && (
                <div className="assignment-popup__section">
                    <h4 className="assignment-popup__section-title">Main Character</h4>
                    <SelectableCharacterCard
                        character={mainCharacter}
                        isSelected={selectedCharacterId === mainCharacter.id}
                        onSelect={() => onSelectCharacter(
                            mainCharacter.id,
                            !slotRole && mainCharacter.effectiveRole ? mainCharacter.effectiveRole as RosterRole : undefined,
                        )}
                        isMain
                    />
                </div>
            )}
            {altCharacters.length > 0 && (
                <div className="assignment-popup__section">
                    <h4 className="assignment-popup__section-title">Alt Characters</h4>
                    <div className="space-y-1.5">
                        {altCharacters.map((char) => (
                            <SelectableCharacterCard
                                key={char.id}
                                character={char}
                                isSelected={selectedCharacterId === char.id}
                                onSelect={() => onSelectCharacter(
                                    char.id,
                                    !slotRole && char.effectiveRole ? char.effectiveRole as RosterRole : undefined,
                                )}
                            />
                        ))}
                    </div>
                </div>
            )}
            <div className="flex gap-2 pt-2">
                <button onClick={onSkip} className="btn btn-secondary btn-sm flex-1">Skip</button>
                <button onClick={onConfirm} disabled={!selectedCharacterId} className="btn btn-primary btn-sm flex-1">
                    Confirm &amp; Assign
                </button>
            </div>
        </>
    );
}
