import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useGameRegistry } from '../hooks/use-game-registry';
import { IntegrationHub } from '../components/profile/IntegrationHub';
import { CharacterList, AddCharacterModal } from '../components/profile';
import { GameTimePanel } from '../components/features/game-time';
import '../components/profile/integration-hub.css';

/**
 * User profile page with character and availability management.
 * ROK-195: Uses IntegrationHub (Hub & Spoke) instead of UserInfoCard.
 */
export function ProfilePage() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();
    const location = useLocation();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string>('');

    // Scroll to hash anchor (e.g., #game-time from modal link)
    useEffect(() => {
        if (location.hash) {
            const el = document.querySelector(location.hash);
            if (el) {
                // Small delay to let the page render fully
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        }
    }, [location.hash]);

    // Show loading state while checking auth
    if (authLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-500 border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    // Redirect if not authenticated
    if (!isAuthenticated || !user) {
        return <Navigate to="/" replace />;
    }

    const characters = charactersData?.data ?? [];

    // Default to first game in registry if no game selected
    const defaultGame = games[0];
    const activeGameId = editingCharacter?.gameId ?? (selectedGameId || (defaultGame?.id ?? ''));
    const activeGameName = games.find(g => g.id === activeGameId)?.name || 'Unknown Game';

    function handleAddCharacter() {
        setEditingCharacter(null);
        if (games.length === 1) {
            setSelectedGameId(games[0].id);
        }
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
        <div className="profile-page relative min-h-screen py-8 px-4">
            {/* Full-page space background (future theme candidate) */}
            <div className="profile-page__nebula" />
            <div className="profile-page__stars" />

            <div className="relative z-10 max-w-3xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">My Profile</h1>
                    <p className="text-slate-400">
                        Manage your characters, game time, and preferences
                    </p>
                </div>

                {/* Integration Hub (ROK-195) — replaces old UserInfoCard */}
                <IntegrationHub
                    user={user}
                    characters={characters}
                    onRefresh={refetch}
                />

                {/* Game Time Section (ROK-189) — unified panel */}
                <div id="game-time" className="bg-slate-900 border border-slate-800 rounded-xl p-6 scroll-mt-8">
                    <GameTimePanel
                        mode="profile"
                        rolling
                        enabled={isAuthenticated}
                    />
                </div>

                {/* Characters Section */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold text-white">My Characters</h2>
                        <button
                            onClick={handleAddCharacter}
                            disabled={games.length === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Character
                        </button>
                    </div>

                    {charactersLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-8 h-8 border-4 border-slate-500 border-t-emerald-500 rounded-full animate-spin" />
                        </div>
                    ) : (
                        <CharacterList
                            characters={characters}
                            onEdit={handleEditCharacter}
                        />
                    )}
                </div>
            </div>

            {/* Add/Edit Character Modal */}
            {activeGameId && (
                <AddCharacterModal
                    isOpen={showAddModal}
                    onClose={handleCloseCharacterModal}
                    gameId={activeGameId}
                    gameName={activeGameName}
                    editingCharacter={editingCharacter}
                />
            )}
        </div>
    );
}
