import { useState } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { useGameTime } from '../../hooks/use-game-time';
import { useUserHeartedGames } from '../../hooks/use-user-profile';
import { GameTimePanel } from '../../components/features/game-time';
import { CharacterList, AddCharacterModal } from '../../components/profile';
import { MyWatchedGamesSection } from '../../components/profile/my-watched-games-section';

type GamingTab = 'game-time' | 'characters' | 'watched-games';

/**
 * Consolidated Gaming panel (ROK-359).
 * Merges Game Time, Characters, and Watched Games into a tabbed page.
 */
export function GamingPanel() {
    const [activeTab, setActiveTab] = useState<GamingTab>('game-time');
    const { user, isAuthenticated } = useAuth();

    // Lift queries for tab badge counts
    const { data: gameTimeData } = useGameTime({ enabled: isAuthenticated });
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);
    const { data: heartedData } = useUserHeartedGames(user?.id);

    const gameTimeSet = (gameTimeData?.slots?.length ?? 0) > 0;
    const characterCount = charactersData?.data?.length ?? 0;
    const watchedCount = heartedData?.data?.length ?? 0;

    const tabs: { id: GamingTab; label: string }[] = [
        { id: 'game-time', label: gameTimeSet ? 'Game Time (Set)' : 'Game Time (Unset)' },
        { id: 'characters', label: `Characters (${characterCount})` },
        { id: 'watched-games', label: `Watched Games (${watchedCount})` },
    ];

    return (
        <div className="space-y-6">
            {/* Tab bar */}
            <div className="flex gap-1 bg-panel/50 rounded-lg p-1 border border-edge/50">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === tab.id
                                ? 'bg-surface text-foreground shadow-sm'
                                : 'text-muted hover:text-foreground hover:bg-overlay/20'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {activeTab === 'game-time' && <GameTimeTab />}
            {activeTab === 'characters' && <CharactersTab />}
            {activeTab === 'watched-games' && <WatchedGamesTab />}
        </div>
    );
}

function GameTimeTab() {
    const { isAuthenticated } = useAuth();
    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
        </div>
    );
}

function CharactersTab() {
    const { isAuthenticated } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

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
        setSelectedGameId(null);
    }

    return (
        <>
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
        </>
    );
}

function WatchedGamesTab() {
    return <MyWatchedGamesSection />;
}
