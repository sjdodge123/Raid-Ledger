import { useState, useEffect } from 'react';
import type { CharacterRole, CharacterDto, GameRegistryDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useCreateCharacter, useUpdateCharacter } from '../../hooks/use-character-mutations';
import { useGameRegistry } from '../../hooks/use-game-registry';

interface AddCharacterModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Pre-selected game ID (used when editing or single-game shortcut) */
    gameId?: string;
    /** Display name for the pre-selected game */
    gameName?: string;
    editingCharacter?: CharacterDto | null;
}

interface FormState {
    name: string;
    class: string;
    spec: string;
    role: CharacterRole | '';
    realm: string;
    isMain: boolean;
}

const getInitialFormState = (char?: CharacterDto | null): FormState => ({
    name: char?.name ?? '',
    class: char?.class ?? '',
    spec: char?.spec ?? '',
    role: char?.role ?? '',
    realm: char?.realm ?? '',
    isMain: char?.isMain ?? false,
});

/**
 * Modal for adding or editing a character.
 * ROK-195 AC-6: Dynamic game selection from game registry.
 * Shows/hides MMO-specific fields (Class, Spec, Role, Realm) based on game's hasRoles flag.
 */
export function AddCharacterModal({
    isOpen,
    onClose,
    gameId: preselectedGameId,
    gameName: preselectedGameName,
    editingCharacter,
}: AddCharacterModalProps) {
    const createMutation = useCreateCharacter();
    const updateMutation = useUpdateCharacter();
    const { games } = useGameRegistry();
    const isEditing = !!editingCharacter;

    // Game selection state
    const [selectedGameId, setSelectedGameId] = useState<string>(preselectedGameId ?? '');

    // Use a key-based reset by tracking when the modal opens
    const [resetKey, setResetKey] = useState(0);
    const [form, setForm] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [error, setError] = useState('');

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setResetKey((k) => k + 1);
        }
    }, [isOpen]);

    // Apply the reset when key changes
    useEffect(() => {
        if (resetKey > 0) {
            const newState = getInitialFormState(editingCharacter);
            setForm(newState);
            setError('');
            // Reset game selection to preselected or editing character's game
            setSelectedGameId(editingCharacter?.gameId ?? preselectedGameId ?? '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    // Find the selected game from registry to check hasRoles
    const selectedGame: GameRegistryDto | undefined = games.find(g => g.id === selectedGameId);
    const showMmoFields = selectedGame?.hasRoles ?? true; // Default to showing all fields if game unknown
    const effectiveGameName = selectedGame?.name ?? preselectedGameName ?? 'Unknown Game';

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!form.name.trim()) {
            setError('Character name is required');
            return;
        }

        if (!selectedGameId) {
            setError('Please select a game');
            return;
        }

        if (isEditing && editingCharacter) {
            updateMutation.mutate(
                {
                    id: editingCharacter.id,
                    dto: {
                        name: form.name.trim(),
                        class: showMmoFields ? (form.class.trim() || null) : null,
                        spec: showMmoFields ? (form.spec.trim() || null) : null,
                        role: showMmoFields ? (form.role || null) : null,
                        realm: showMmoFields ? (form.realm.trim() || null) : null,
                    },
                },
                {
                    onSuccess: () => {
                        onClose();
                    },
                }
            );
        } else {
            createMutation.mutate(
                {
                    gameId: selectedGameId,
                    name: form.name.trim(),
                    class: showMmoFields ? (form.class.trim() || undefined) : undefined,
                    spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
                    role: showMmoFields ? (form.role || undefined) : undefined,
                    realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
                    isMain: form.isMain,
                },
                {
                    onSuccess: () => {
                        onClose();
                        setForm({
                            name: '',
                            class: '',
                            spec: '',
                            role: '',
                            realm: '',
                            isMain: false,
                        });
                    },
                }
            );
        }
    }

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    const isPending = createMutation.isPending || updateMutation.isPending;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit Character' : 'Add Character'}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Game Selector (AC-6) — Disabled when editing */}
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                        Game <span className="text-red-400">*</span>
                    </label>
                    {isEditing ? (
                        <div className="px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-400 text-sm">
                            {effectiveGameName}
                        </div>
                    ) : (
                        <select
                            value={selectedGameId}
                            onChange={(e) => setSelectedGameId(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            {!selectedGameId && (
                                <option value="">Select a game...</option>
                            )}
                            {games.map((game) => (
                                <option key={game.id} value={game.id}>
                                    {game.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Character Name */}
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                        Name <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        placeholder="Character name"
                        maxLength={100}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                </div>

                {/* MMO-specific fields — only shown when game hasRoles */}
                {showMmoFields && (
                    <>
                        {/* Class & Spec */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1">
                                    Class
                                </label>
                                <input
                                    type="text"
                                    value={form.class}
                                    onChange={(e) => updateField('class', e.target.value)}
                                    placeholder="e.g. Warrior"
                                    maxLength={50}
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1">
                                    Spec
                                </label>
                                <input
                                    type="text"
                                    value={form.spec}
                                    onChange={(e) => updateField('spec', e.target.value)}
                                    placeholder="e.g. Arms"
                                    maxLength={50}
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                        </div>

                        {/* Role */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">
                                Role
                            </label>
                            <select
                                value={form.role}
                                onChange={(e) => updateField('role', e.target.value as CharacterRole | '')}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Select role...</option>
                                <option value="tank">Tank</option>
                                <option value="healer">Healer</option>
                                <option value="dps">DPS</option>
                            </select>
                        </div>

                        {/* Realm (optional) */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">
                                Realm/Server
                            </label>
                            <input
                                type="text"
                                value={form.realm}
                                onChange={(e) => updateField('realm', e.target.value)}
                                placeholder="e.g. Illidan"
                                maxLength={100}
                                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                    </>
                )}

                {/* Set as Main (only for create) */}
                {!isEditing && (
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.isMain}
                            onChange={(e) => updateField('isMain', e.target.checked)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-slate-300">Set as main character</span>
                    </label>
                )}

                {/* Error */}
                {error && (
                    <p className="text-sm text-red-400">{error}</p>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isPending}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors"
                    >
                        {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Character'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
