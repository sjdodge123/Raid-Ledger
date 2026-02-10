import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useThemeStore } from '../stores/theme-store';
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
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
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
                    <h1 className="text-3xl font-bold text-foreground mb-2">My Profile</h1>
                    <p className="text-muted">
                        Manage your characters, game time, and preferences
                    </p>
                </div>

                {/* Integration Hub (ROK-195) — replaces old UserInfoCard */}
                <IntegrationHub
                    user={user}
                    characters={characters}
                    onRefresh={refetch}
                />

                {/* Appearance Section (ROK-124) */}
                <AppearanceSection />

                {/* Game Time Section (ROK-189) — unified panel */}
                <div id="game-time" className="bg-surface border border-edge-subtle rounded-xl p-6 scroll-mt-8">
                    <GameTimePanel
                        mode="profile"
                        rolling
                        enabled={isAuthenticated}
                    />
                </div>

                {/* Characters Section */}
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

const THEME_OPTIONS = [
    { id: 'default-dark', label: 'Dark', subtitle: 'Always dark' },
    { id: 'default-light', label: 'Light', subtitle: 'Always light' },
    { id: 'auto', label: 'Auto', subtitle: 'Match system' },
] as const;

function AppearanceSection() {
    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Appearance</h2>
            <p className="text-sm text-muted mb-4">Choose your preferred color scheme</p>
            <div className="flex gap-3">
                {THEME_OPTIONS.map((opt) => (
                    <button
                        key={opt.id}
                        onClick={() => setTheme(opt.id)}
                        className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors text-center ${
                            themeId === opt.id
                                ? 'border-emerald-500 bg-emerald-500/10 text-foreground'
                                : 'border-edge bg-panel text-secondary hover:border-edge-strong'
                        }`}
                    >
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted mt-0.5">{opt.subtitle}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}
