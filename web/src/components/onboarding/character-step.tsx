import { useState } from 'react';
import type { CharacterRole, GameRegistryDto } from '@raid-ledger/contract';
import { useCreateCharacter, useDeleteCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';
import { PluginSlot } from '../../plugins';
import { CharacterCardCompact } from '../characters/character-card-compact';

interface CharacterStepProps {
    /** The registry game to create a character for (pre-filled from hearted games) */
    preselectedGame: GameRegistryDto;
    /** Which character slot this step represents (0-based) */
    charIndex: number;
    /** Register a validator fn with the wizard. Return false = block Next. */
    onRegisterValidator?: (fn: () => boolean) => void;
    /** Insert a new character step for the same game and advance to it */
    onAddAnother?: () => void;
    /** Remove this extra step (only for charIndex > 0) */
    onRemoveStep?: () => void;
}

interface FormState {
    name: string;
    class: string;
    spec: string;
    role: CharacterRole | '';
    realm: string;
}

/**
 * Step: Create a Character for a specific game.
 * Each step is 1:1 with a character slot (by charIndex).
 * Shows the saved character or the creation form.
 */
export function CharacterStep({ preselectedGame, charIndex, onRegisterValidator, onAddAnother, onRemoveStep }: CharacterStepProps) {
    const createMutation = useCreateCharacter();
    const deleteMutation = useDeleteCharacter();
    const { data: myCharsData } = useMyCharacters(preselectedGame.id);

    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
    const [form, setForm] = useState<FormState>({
        name: '',
        class: '',
        spec: '',
        role: '',
        realm: '',
    });
    const [error, setError] = useState('');

    const showMmoFields = preselectedGame.hasRoles;
    const currentSlug = preselectedGame.slug;

    // Characters already created for this game — this step shows charIndex-th one
    const existingChars = myCharsData?.data ?? [];
    const savedCharacter = existingChars[charIndex] ?? null;
    const hasCharacter = !!savedCharacter;

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    function resetForm() {
        setForm({ name: '', class: '', spec: '', role: '', realm: '' });
        setError('');
        setActiveTab('manual');
    }

    function handleDeleteCharacter(id: string) {
        deleteMutation.mutate(id, {
            onSuccess: () => {
                // If this is an extra step (not the first), remove the step entirely
                if (charIndex > 0) {
                    onRemoveStep?.();
                }
            },
        });
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!form.name.trim()) {
            setError('Character name is required');
            return;
        }

        createMutation.mutate(
            {
                gameId: preselectedGame.id,
                name: form.name.trim(),
                class: showMmoFields ? (form.class.trim() || undefined) : undefined,
                spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
                role: showMmoFields ? (form.role || undefined) : undefined,
                realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
                isMain: existingChars.length === 0, // first character for this game is main
            },
            {
                onSuccess: () => {
                    resetForm();
                },
                onError: () => {
                    setError('Failed to create character. Please try again.');
                },
            },
        );
    }

    return (
        <div className="space-y-4">
            <div className="text-center">
                <h2 className="text-xl font-bold text-foreground">
                    Create a Character — {preselectedGame.name}
                </h2>
                <p className="text-muted text-sm mt-1">
                    You can always add more from your profile later.
                </p>
            </div>

            {/* Saved character card — 1:1 with this step */}
            {hasCharacter && (
                <div className="max-w-md mx-auto space-y-3">
                    <div className="relative">
                        <CharacterCardCompact character={savedCharacter} size="sm" />
                        <button
                            type="button"
                            onClick={() => handleDeleteCharacter(savedCharacter.id)}
                            disabled={deleteMutation.isPending}
                            title="Remove character"
                            className="absolute top-1 right-1 w-10 h-10 flex items-center justify-center rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 transition-colors disabled:opacity-40"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Add Another — inserts a new step */}
                    <button
                        type="button"
                        onClick={onAddAnother}
                        className="w-full px-4 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted hover:text-foreground border border-edge/50 rounded-lg transition-colors text-sm"
                    >
                        + Add Another Character
                    </button>
                </div>
            )}

            {/* Character creation form — shown when no character saved for this step */}
            {!hasCharacter && (
                <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4">
                    {/* Plugin: Import form tab toggle (e.g. WoW Armory) */}
                    {currentSlug && (
                        <PluginSlot
                            name="character-create:import-form"
                            context={{
                                onClose: () => { /* cache invalidation hides form */ },
                                gameSlug: currentSlug,
                                activeTab,
                                onTabChange: setActiveTab,
                                existingCharacters: existingChars,
                                onRegisterValidator,
                            }}
                        />
                    )}

                    {activeTab === 'manual' && (
                        <>
                            {/* Character Name */}
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">
                                    Name <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => updateField('name', e.target.value)}
                                    placeholder="Character name"
                                    maxLength={100}
                                    className="w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                />
                            </div>

                            {/* MMO-specific fields */}
                            {showMmoFields && (
                                <>
                                    {/* Class & Spec */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1">
                                                Class
                                            </label>
                                            <input
                                                type="text"
                                                value={form.class}
                                                onChange={(e) => updateField('class', e.target.value)}
                                                placeholder="e.g. Warrior"
                                                maxLength={50}
                                                className="w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-foreground mb-1">
                                                Spec
                                            </label>
                                            <input
                                                type="text"
                                                value={form.spec}
                                                onChange={(e) => updateField('spec', e.target.value)}
                                                placeholder="e.g. Arms"
                                                maxLength={50}
                                                className="w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                            />
                                        </div>
                                    </div>

                                    {/* Role */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1">
                                            Role
                                        </label>
                                        <select
                                            value={form.role}
                                            onChange={(e) => updateField('role', e.target.value as CharacterRole | '')}
                                            className="w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                        >
                                            <option value="">Select role...</option>
                                            <option value="tank">Tank</option>
                                            <option value="healer">Healer</option>
                                            <option value="dps">DPS</option>
                                        </select>
                                    </div>

                                    {/* Realm */}
                                    <div>
                                        <label className="block text-sm font-medium text-foreground mb-1">
                                            Realm/Server
                                        </label>
                                        <input
                                            type="text"
                                            value={form.realm}
                                            onChange={(e) => updateField('realm', e.target.value)}
                                            placeholder="e.g. Illidan"
                                            maxLength={100}
                                            className="w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Error */}
                            {error && (
                                <p className="text-sm text-red-400">{error}</p>
                            )}

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={createMutation.isPending}
                                className="w-full px-4 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-medium rounded-lg transition-colors text-sm"
                            >
                                {createMutation.isPending ? 'Creating...' : 'Create Character'}
                            </button>
                        </>
                    )}
                </form>
            )}

        </div>
    );
}
