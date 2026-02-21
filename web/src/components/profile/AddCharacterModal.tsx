import { useState, useMemo } from 'react';
import type { CharacterRole, CharacterDto, IgdbGameDto } from '@raid-ledger/contract';
import { LockClosedIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Modal } from '../ui/modal';
import { useCreateCharacter, useUpdateCharacter, useSetMainCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { GameSearchInput } from '../events/game-search-input';
import { PluginSlot } from '../../plugins';

interface AddCharacterModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Pre-selected game ID (used when editing or single-game shortcut) */
    gameId?: number;
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
 * ROK-234: IGDB-powered game search, realm autocomplete, preview flow.
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
    const setMainMutation = useSetMainCharacter();
    const { games: registryGames } = useGameRegistry();
    const isEditing = !!editingCharacter;
    const isArmorySynced = !!editingCharacter?.lastSyncedAt;

    // IGDB game selection state
    const [selectedIgdbGame, setSelectedIgdbGame] = useState<IgdbGameDto | null>(null);
    // Import tab state
    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');

    // Track previous isOpen to reset state synchronously during render (no stale flash)
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [form, setForm] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [error, setError] = useState('');

    // Resolve IGDB game → registry game
    const registryGame = useMemo(() => {
        if (!selectedIgdbGame) return undefined;
        return registryGames.find(
            (g) =>
                g.name.toLowerCase() === selectedIgdbGame.name.toLowerCase() ||
                g.slug === selectedIgdbGame.slug,
        );
    }, [selectedIgdbGame, registryGames]);

    // Also find registry game for preselected gameId (editing mode)
    const preselectedRegistryGame = useMemo(() => {
        if (!preselectedGameId) return undefined;
        return registryGames.find((g) => g.id === preselectedGameId);
    }, [preselectedGameId, registryGames]);

    const effectiveRegistryGame = isEditing ? preselectedRegistryGame : registryGame;
    const effectiveGameId = effectiveRegistryGame?.id ?? preselectedGameId;
    const effectiveGameName = effectiveRegistryGame?.name ?? preselectedGameName ?? selectedIgdbGame?.name ?? 'Unknown Game';
    const showMmoFields = effectiveRegistryGame?.hasRoles ?? (selectedIgdbGame ? false : true);

    const currentSlug = effectiveRegistryGame?.slug ?? selectedIgdbGame?.slug ?? '';

    // Fetch characters scoped to this game for defaulting isMain
    const { data: gameCharsData } = useMyCharacters(effectiveGameId, !!effectiveGameId);
    const gameChars = gameCharsData?.data ?? [];
    const hasMainForGame = gameChars.some((c) => c.isMain);

    // Reset all form state synchronously when modal opens (avoids stale-frame flash).
    // This is React's recommended "adjust state during render" pattern:
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    if (isOpen && !prevIsOpen) {
        setPrevIsOpen(true);
        setResetKey((k) => k + 1);
        const initial = getInitialFormState(editingCharacter);
        // Default isMain=true when creating and no main exists for this game yet
        if (!editingCharacter && !hasMainForGame) {
            initial.isMain = true;
        }
        setForm(initial);
        setError('');
        if (!editingCharacter) {
            if (preselectedGameId) {
                const match = registryGames.find((g) => g.id === preselectedGameId);
                if (match) {
                    setSelectedIgdbGame({
                        id: 0,
                        igdbId: 0,
                        name: match.name,
                        slug: match.slug,
                        coverUrl: null,
                    });
                }
            } else {
                setSelectedIgdbGame(null);
            }
        }
    }
    if (!isOpen && prevIsOpen) {
        setPrevIsOpen(false);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!form.name.trim()) {
            setError('Character name is required');
            return;
        }

        if (!effectiveGameId && !selectedIgdbGame) {
            setError('Please select a game');
            return;
        }

        if (!effectiveGameId) {
            setError('This game is not registered in the system. Only a name can be set for generic characters.');
            return;
        }

        if (isEditing && editingCharacter) {
            // If isMain was toggled on, set main first then update fields
            const needsSetMain = form.isMain && !editingCharacter.isMain;

            const doUpdate = () => {
                updateMutation.mutate(
                    {
                        id: editingCharacter.id,
                        dto: {
                            name: form.name.trim(),
                            class: showMmoFields ? (form.class.trim() || null) : null,
                            spec: showMmoFields ? (form.spec.trim() || null) : null,
                            roleOverride: showMmoFields ? (form.role || null) : null,
                            realm: showMmoFields ? (form.realm.trim() || null) : null,
                        },
                    },
                    {
                        onSuccess: () => {
                            onClose();
                        },
                    }
                );
            };

            if (needsSetMain) {
                setMainMutation.mutate(editingCharacter.id, {
                    onSuccess: () => {
                        doUpdate();
                    },
                });
            } else {
                doUpdate();
            }
        } else {
            createMutation.mutate(
                {
                    gameId: effectiveGameId!,
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
                        setSelectedIgdbGame(null);
                    },
                }
            );
        }
    }

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    const isPending = createMutation.isPending || updateMutation.isPending || setMainMutation.isPending;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit Character' : 'Add Character'}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Game Selector — IGDB search for create, static text for edit */}
                {isEditing ? (
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">
                            Game
                        </label>
                        <div className="px-3 py-2 bg-panel/50 border border-edge/50 rounded-lg text-muted text-sm">
                            {effectiveGameName}
                        </div>
                    </div>
                ) : (
                    <GameSearchInput
                        key={resetKey}
                        value={selectedIgdbGame}
                        onChange={(game) => setSelectedIgdbGame(game)}
                        error={error && !selectedIgdbGame && !effectiveGameId ? error : undefined}

                    />
                )}

                {/* Plugin: Import form tab toggle + variant + import form (ROK-238) */}
                {!isEditing && currentSlug && (
                    <PluginSlot
                        name="character-create:import-form"
                        context={{
                            onClose,
                            gameSlug: currentSlug,
                            activeTab,
                            onTabChange: setActiveTab,
                            defaultIsMain: !hasMainForGame,
                            existingCharacters: gameChars,
                        }}
                    />
                )}

                {activeTab === 'manual' && (
                    <>
                        {/* Only show manual form fields when a game is selected */}
                        {(selectedIgdbGame || isEditing) && (
                            <>
                                {/* Armory sync info banner */}
                                {isArmorySynced && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-sm">
                                        <InformationCircleIcon className="w-4 h-4 flex-shrink-0" />
                                        <span>This character is synced from the Blizzard Armory. Some fields are read-only.</span>
                                    </div>
                                )}

                                {/* Character Name */}
                                <div>
                                    <label className="block text-sm font-medium text-secondary mb-1">
                                        Name <span className="text-red-400">*</span>
                                        {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                                    </label>
                                    <input
                                        type="text"
                                        value={form.name}
                                        onChange={(e) => updateField('name', e.target.value)}
                                        placeholder="Character name"
                                        maxLength={100}
                                        disabled={isArmorySynced}
                                        title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                        className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                                    />
                                </div>

                                {/* MMO-specific fields — only shown when game hasRoles */}
                                {showMmoFields && (
                                    <>
                                        {/* Class & Spec */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-secondary mb-1">
                                                    Class
                                                    {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={form.class}
                                                    onChange={(e) => updateField('class', e.target.value)}
                                                    placeholder="e.g. Warrior"
                                                    maxLength={50}
                                                    disabled={isArmorySynced}
                                                    title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                                    className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-secondary mb-1">
                                                    Spec
                                                    {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={form.spec}
                                                    onChange={(e) => updateField('spec', e.target.value)}
                                                    placeholder="e.g. Arms"
                                                    maxLength={50}
                                                    disabled={isArmorySynced}
                                                    title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                                    className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                />
                                            </div>
                                        </div>

                                        {/* Role */}
                                        <div>
                                            <label className="block text-sm font-medium text-secondary mb-1">
                                                Role
                                            </label>
                                            <select
                                                value={form.role}
                                                onChange={(e) => updateField('role', e.target.value as CharacterRole | '')}
                                                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                            >
                                                <option value="">Select role...</option>
                                                <option value="tank">Tank</option>
                                                <option value="healer">Healer</option>
                                                <option value="dps">DPS</option>
                                            </select>
                                        </div>

                                        {/* Realm (optional) */}
                                        <div>
                                            <label className="block text-sm font-medium text-secondary mb-1">
                                                Realm/Server
                                                {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                                            </label>
                                            <input
                                                type="text"
                                                value={form.realm}
                                                onChange={(e) => updateField('realm', e.target.value)}
                                                placeholder="e.g. Illidan"
                                                maxLength={100}
                                                disabled={isArmorySynced}
                                                title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                                className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                    </>
                                )}

                                {/* Main character toggle */}
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.isMain}
                                        onChange={(e) => updateField('isMain', e.target.checked)}
                                        disabled={(isEditing && editingCharacter?.isMain) || (!isEditing && !hasMainForGame)}
                                        className="w-4 h-4 rounded border-edge-strong bg-panel text-emerald-500 focus:ring-emerald-500 disabled:opacity-50"
                                    />
                                    <span className={`text-sm ${(isEditing && editingCharacter?.isMain) || (!isEditing && !hasMainForGame) ? 'text-muted' : 'text-secondary'}`}>
                                        Main character
                                        {isEditing && editingCharacter?.isMain && (
                                            <span className="ml-1 text-xs text-muted">(already main)</span>
                                        )}
                                        {!isEditing && !hasMainForGame && (
                                            <span className="ml-1 text-xs text-muted">(no main set)</span>
                                        )}
                                    </span>
                                </label>
                            </>
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
                                className="px-4 py-2 text-secondary hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isPending}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors"
                            >
                                {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Character'}
                            </button>
                        </div>
                    </>
                )}
            </form>
        </Modal>
    );
}
