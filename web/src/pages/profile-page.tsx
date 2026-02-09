import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { CharacterDto, AvailabilityDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useAvailability, useDeleteAvailability } from '../hooks/use-availability';
import { useGameRegistry } from '../hooks/use-game-registry';
import { IntegrationHub } from '../components/profile/IntegrationHub';
import { CharacterList, AddCharacterModal } from '../components/profile';
import { AvailabilityList, AvailabilityForm } from '../components/features/availability';
import { toast } from 'sonner';
import '../components/profile/integration-hub.css';

/**
 * User profile page with character and availability management.
 * ROK-195: Uses IntegrationHub (Hub & Spoke) instead of UserInfoCard.
 */
export function ProfilePage() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { data: availabilityData, isLoading: availabilityLoading } = useAvailability({ enabled: isAuthenticated });
    const deleteAvailability = useDeleteAvailability();
    const { games } = useGameRegistry();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string>('');

    const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
    const [editingAvailability, setEditingAvailability] = useState<AvailabilityDto | null>(null);

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
    const availabilities = availabilityData?.data ?? [];

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

    function handleEditAvailability(availability: AvailabilityDto) {
        setEditingAvailability(availability);
        setShowAvailabilityModal(true);
    }

    function handleCloseAvailabilityModal() {
        setShowAvailabilityModal(false);
        setEditingAvailability(null);
    }

    async function handleDeleteAvailability(id: string) {
        try {
            await deleteAvailability.mutateAsync(id);
            toast.success('Availability deleted');
        } catch {
            toast.error('Failed to delete availability');
        }
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
                        Manage your characters, availability, and preferences
                    </p>
                </div>

                {/* Integration Hub (ROK-195) — replaces old UserInfoCard */}
                <IntegrationHub
                    user={user}
                    characters={characters}
                    onRefresh={refetch}
                />

                {/* Availability Section (ROK-112) */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-semibold text-white">My Availability</h2>
                            <p className="text-slate-400 text-sm mt-1">
                                Set when you're free to help raid leaders schedule events
                            </p>
                        </div>
                        <button
                            onClick={() => setShowAvailabilityModal(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Availability
                        </button>
                    </div>

                    <AvailabilityList
                        availabilities={availabilities}
                        isLoading={availabilityLoading}
                        onEdit={handleEditAvailability}
                        onDelete={handleDeleteAvailability}
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

            {/* Add/Edit Availability Modal (ROK-112) */}
            <AvailabilityForm
                isOpen={showAvailabilityModal}
                onClose={handleCloseAvailabilityModal}
                editingAvailability={editingAvailability}
            />
        </div>
    );
}
