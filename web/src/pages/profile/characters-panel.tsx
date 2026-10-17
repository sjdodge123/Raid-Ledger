import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { readCharacterPrefill, type CharacterPrefill } from '../../plugins/character-identity';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { CharacterList, AddCharacterModal } from '../../components/profile';

function useCharacterModal(games: { id: number }[]) {
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
    const [prefill, setPrefill] = useState<CharacterPrefill | null>(null);

    const openWithPrefill = useCallback((p: CharacterPrefill) => {
        setEditingCharacter(null);
        setSelectedGameId(p.gameId);
        setPrefill(p);
        setShowAddModal(true);
    }, []);

    function handleAdd() {
        setEditingCharacter(null); setPrefill(null);
        const [onlyGame] = games;
        if (games.length === 1 && onlyGame) setSelectedGameId(onlyGame.id);
        setShowAddModal(true);
    }

    function handleEdit(character: CharacterDto) {
        setEditingCharacter(character);
        setPrefill(null);
        setSelectedGameId(character.gameId);
        setShowAddModal(true);
    }

    function handleClose() {
        setShowAddModal(false);
        setEditingCharacter(null);
        setSelectedGameId(null); setPrefill(null);
    }

    return { showAddModal, editingCharacter, selectedGameId, prefill, openWithPrefill, handleAdd, handleEdit, handleClose };
}

/**
 * Router state `{ addCharacter }` (e.g. a plugin's "add this character" link)
 * opens Add Character prefilled once the game registry is loaded, then clears
 * the state so a refresh or Back does not reopen it.
 */
function useRoutedCharacterPrefill(ready: boolean, openWithPrefill: (p: CharacterPrefill) => void) {
    const location = useLocation();
    const navigate = useNavigate();
    const prefill = readCharacterPrefill(location.state);
    useEffect(() => {
        if (!prefill || !ready) return;
        openWithPrefill(prefill);
        navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }, [prefill, ready, openWithPrefill, navigate, location.pathname, location.search]);
}

function CharactersPanelHeader({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
    return (
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-foreground">My Characters</h2>
            <button onClick={onAdd} disabled={disabled}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Character
            </button>
        </div>
    );
}

export function CharactersPanel() {
    const { isAuthenticated } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();
    const modal = useCharacterModal(games);
    useRoutedCharacterPrefill(games.length > 0, modal.openWithPrefill);

    const characters = charactersData?.data ?? [];
    const activeGameId = modal.editingCharacter?.gameId ?? (modal.selectedGameId || undefined);
    const activeGameName = activeGameId ? (games.find(g => g.id === activeGameId)?.name || 'Unknown Game') : undefined;

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <CharactersPanelHeader onAdd={modal.handleAdd} disabled={games.length === 0} />
                {charactersLoading
                    ? <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" /></div>
                    : <CharacterList characters={characters} onEdit={modal.handleEdit} />}
            </div>
            <AddCharacterModal isOpen={modal.showAddModal} onClose={modal.handleClose} gameId={activeGameId} gameName={activeGameName} editingCharacter={modal.editingCharacter} prefill={modal.prefill} />
        </div>
    );
}
