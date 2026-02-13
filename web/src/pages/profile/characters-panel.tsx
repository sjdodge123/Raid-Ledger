import { useState } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { CharacterList, AddCharacterModal } from '../../components/profile';

export function CharactersPanel() {
    const { isAuthenticated } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string>('');

    const characters = charactersData?.data ?? [];
    const activeGameId = editingCharacter?.gameId ?? (selectedGameId || undefined);
    const activeGameName = activeGameId ? (games.find(g => g.id === activeGameId)?.name || 'Unknown Game') : undefined;

    function handleAddCharacter() {
        setEditingCharacter(null);
        if (games.length === 1) setSelectedGameId(games[0].id);
        setShowAddModal(true);
    }

    function handleEditCharacter(character: CharacterDto) {
        setEditingCharacter(character);
        setSelectedGameId(character.gameId);
        setShowAddModal(true);
    }

    function handleCloseCharacterModal() {
        setShowAddModal(false);
        setEditingCharacter(null);
        setSelectedGameId('');
    }

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-foreground">My Characters</h2>
                    <button
                        onClick={handleAddCharacter}
                        disabled={games.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Character
                    </button>
                </div>

                {charactersLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
                    </div>
                ) : (
                    <CharacterList
                        characters={characters}
                        onEdit={handleEditCharacter}
                    />
                )}
            </div>

            <AddCharacterModal
                isOpen={showAddModal}
                onClose={handleCloseCharacterModal}
                gameId={activeGameId}
                gameName={activeGameName}
                editingCharacter={editingCharacter}
            />
        </div>
    );
}
