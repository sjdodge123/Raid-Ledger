import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { CharacterDto, AvailabilityDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useAvailability, useDeleteAvailability } from '../hooks/use-availability';
import { UserInfoCard, CharacterList, AddCharacterModal } from '../components/profile';
import { AvailabilityList, AvailabilityForm } from '../components/features/availability';
import { toast } from 'sonner';

// Hardcoded default game for demo - in a real app this would come from game-registry
const DEFAULT_GAME = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'World of Warcraft',
};

/**
 * User profile page with character and availability management.
 */
export function ProfilePage() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { data: availabilityData, isLoading: availabilityLoading } = useAvailability({ enabled: isAuthenticated });
    const deleteAvailability = useDeleteAvailability();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);

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

    function handleEditCharacter(character: CharacterDto) {
        setEditingCharacter(character);
        setShowAddModal(true);
    }

    function handleCloseCharacterModal() {
        setShowAddModal(false);
        setEditingCharacter(null);
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
        <div className="py-8 px-4">
            <div className="max-w-3xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">My Profile</h1>
                    <p className="text-slate-400">
                        Manage your characters, availability, and preferences
                    </p>
                </div>

                {/* User Info Card */}
                <UserInfoCard user={user} onRefresh={refetch} />

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
                            onClick={() => setShowAddModal(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
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
            <AddCharacterModal
                isOpen={showAddModal}
                onClose={handleCloseCharacterModal}
                gameId={editingCharacter?.gameId ?? DEFAULT_GAME.id}
                gameName={DEFAULT_GAME.name}
                editingCharacter={editingCharacter}
            />

            {/* Add/Edit Availability Modal (ROK-112) */}
            <AvailabilityForm
                isOpen={showAvailabilityModal}
                onClose={handleCloseAvailabilityModal}
                editingAvailability={editingAvailability}
            />
        </div>
    );
}
