import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { UserInfoCard, CharacterList, AddCharacterModal } from '../components/profile';

// Hardcoded default game for demo - in a real app this would come from game-registry
const DEFAULT_GAME = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'World of Warcraft',
};

/**
 * User profile page with character management.
 */
export function ProfilePage() {
    const { user, isLoading: authLoading, isAuthenticated } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);

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

    function handleEdit(character: CharacterDto) {
        setEditingCharacter(character);
        setShowAddModal(true);
    }

    function handleCloseModal() {
        setShowAddModal(false);
        setEditingCharacter(null);
    }

    return (
        <div className="py-8 px-4">
            <div className="max-w-3xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">My Profile</h1>
                    <p className="text-slate-400">
                        Manage your characters and preferences
                    </p>
                </div>

                {/* User Info Card */}
                <UserInfoCard user={user} />

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
                            onEdit={handleEdit}
                        />
                    )}
                </div>
            </div>

            {/* Add/Edit Character Modal */}
            <AddCharacterModal
                isOpen={showAddModal}
                onClose={handleCloseModal}
                gameId={editingCharacter?.gameId ?? DEFAULT_GAME.id}
                gameName={DEFAULT_GAME.name}
                editingCharacter={editingCharacter}
            />
        </div>
    );
}
