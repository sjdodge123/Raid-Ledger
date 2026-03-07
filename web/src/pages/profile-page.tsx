import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useGameRegistry } from '../hooks/use-game-registry';
import { CharacterList, AddCharacterModal, NotificationPreferencesSection } from '../components/profile';
import { TimezoneSection } from '../components/profile/TimezoneSection';
import { GameTimePanel } from '../components/features/game-time';
import { AppearanceSection } from './profile/appearance-components';

/**
 * Legacy profile page — kept for reference but not routed.
 * Active profile uses ProfileLayout with sidebar navigation (ROK-290).
 */
export function ProfilePage(): JSX.Element {
    const { user, isLoading: authLoading, isAuthenticated } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();
    const location = useLocation();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

    useEffect(() => {
        if (location.hash) {
            const el = document.querySelector(location.hash);
            if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    }, [location.hash]);

    if (authLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated || !user) return <Navigate to="/" replace />;

    const characters = charactersData?.data ?? [];
    const activeGameId = editingCharacter?.gameId ?? (selectedGameId || undefined);
    const activeGameName = activeGameId ? (games.find(g => g.id === activeGameId)?.name || 'Unknown Game') : undefined;

    function handleAddCharacter(): void {
        setEditingCharacter(null);
        if (games.length === 1) setSelectedGameId(games[0].id);
        setShowAddModal(true);
    }

    function handleEditCharacter(character: CharacterDto): void {
        setEditingCharacter(character);
        setSelectedGameId(character.gameId);
        setShowAddModal(true);
    }

    function handleCloseCharacterModal(): void {
        setShowAddModal(false);
        setEditingCharacter(null);
        setSelectedGameId(null);
    }

    return (
        <div className="profile-page relative min-h-screen py-8 px-4">
            <div className="profile-page__nebula" />
            <div className="profile-page__stars" />
            <div className="relative z-10 max-w-3xl mx-auto space-y-8">
                <div>
                    <h1 className="text-3xl font-bold text-foreground mb-2">My Profile</h1>
                    <p className="text-muted">Manage your characters, game time, and preferences</p>
                </div>
                <AppearanceSection />
                <TimezoneSection />
                <NotificationPreferencesSection />
                <div id="game-time" className="bg-surface border border-edge-subtle rounded-xl p-6 scroll-mt-8">
                    <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
                </div>
                <CharactersSection characters={characters} isLoading={charactersLoading} gamesAvailable={games.length > 0}
                    onAdd={handleAddCharacter} onEdit={handleEditCharacter} />
            </div>
            <AddCharacterModal isOpen={showAddModal} onClose={handleCloseCharacterModal}
                gameId={activeGameId} gameName={activeGameName} editingCharacter={editingCharacter} />
        </div>
    );
}

/** Characters section with add button */
function CharactersSection({ characters, isLoading, gamesAvailable, onAdd, onEdit }: {
    characters: CharacterDto[]; isLoading: boolean; gamesAvailable: boolean;
    onAdd: () => void; onEdit: (c: CharacterDto) => void;
}): JSX.Element {
    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-foreground">My Characters</h2>
                <button onClick={onAdd} disabled={!gamesAvailable}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Character
                </button>
            </div>
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
                </div>
            ) : (
                <CharacterList characters={characters} onEdit={onEdit} />
            )}
        </div>
    );
}
