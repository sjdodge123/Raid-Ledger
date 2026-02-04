import { useState, useEffect } from 'react';
import type { CharacterRole, CharacterDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useCreateCharacter, useUpdateCharacter } from '../../hooks/use-character-mutations';

interface AddCharacterModalProps {
    isOpen: boolean;
    onClose: () => void;
    gameId: string;
    gameName: string;
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
 */
export function AddCharacterModal({
    isOpen,
    onClose,
    gameId,
    gameName,
    editingCharacter,
}: AddCharacterModalProps) {
    const createMutation = useCreateCharacter();
    const updateMutation = useUpdateCharacter();
    const isEditing = !!editingCharacter;

    const [form, setForm] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [error, setError] = useState('');

    // Reset form when editingCharacter changes or modal opens
    useEffect(() => {
        if (isOpen) {
            setForm(getInitialFormState(editingCharacter));
            setError('');
        }
    }, [isOpen, editingCharacter]);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!form.name.trim()) {
            setError('Character name is required');
            return;
        }

        if (isEditing && editingCharacter) {
            updateMutation.mutate(
                {
                    id: editingCharacter.id,
                    dto: {
                        name: form.name.trim(),
                        class: form.class.trim() || null,
                        spec: form.spec.trim() || null,
                        role: form.role || null,
                        realm: form.realm.trim() || null,
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
                    gameId,
                    name: form.name.trim(),
                    class: form.class.trim() || undefined,
                    spec: form.spec.trim() || undefined,
                    role: form.role || undefined,
                    realm: form.realm.trim() || undefined,
                    isMain: form.isMain,
                },
                {
                    onSuccess: () => {
                        onClose();
                        // Reset form
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
                <p className="text-sm text-slate-400 mb-4">
                    {isEditing ? 'Update' : 'Add a character for'} <span className="text-emerald-400">{gameName}</span>
                </p>

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
