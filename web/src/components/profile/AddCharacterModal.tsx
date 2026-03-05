import { useState, useMemo } from 'react';
import type { CharacterRole, CharacterDto, IgdbGameDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useCreateCharacter, useUpdateCharacter, useSetMainCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { GameSearchInput } from '../events/game-search-input';
import { PluginSlot } from '../../plugins';
import { CharacterFormFields } from './character-form-fields';

interface AddCharacterModalProps {
    isOpen: boolean;
    onClose: () => void;
    gameId?: number;
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
    name: char?.name ?? '', class: char?.class ?? '', spec: char?.spec ?? '',
    role: char?.role ?? '', realm: char?.realm ?? '', isMain: char?.isMain ?? false,
});

export function AddCharacterModal({
    isOpen, onClose, gameId: preselectedGameId, gameName: preselectedGameName, editingCharacter,
}: AddCharacterModalProps) {
    const createMutation = useCreateCharacter();
    const updateMutation = useUpdateCharacter();
    const setMainMutation = useSetMainCharacter();
    const { games: registryGames } = useGameRegistry();
    const isEditing = !!editingCharacter;
    const isArmorySynced = !!editingCharacter?.lastSyncedAt;

    const [selectedIgdbGame, setSelectedIgdbGame] = useState<IgdbGameDto | null>(null);
    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [form, setForm] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [error, setError] = useState('');

    const registryGame = useMemo(() => {
        if (!selectedIgdbGame) return undefined;
        return registryGames.find((g) => g.name.toLowerCase() === selectedIgdbGame.name.toLowerCase() || g.slug === selectedIgdbGame.slug);
    }, [selectedIgdbGame, registryGames]);

    const preselectedRegistryGame = useMemo(() => {
        if (!preselectedGameId) return undefined;
        return registryGames.find((g) => g.id === preselectedGameId);
    }, [preselectedGameId, registryGames]);

    const effectiveRegistryGame = isEditing ? preselectedRegistryGame : registryGame;
    const effectiveGameId = effectiveRegistryGame?.id ?? preselectedGameId;
    const effectiveGameName = effectiveRegistryGame?.name ?? preselectedGameName ?? selectedIgdbGame?.name ?? 'Unknown Game';
    const showMmoFields = effectiveRegistryGame?.hasRoles ?? (selectedIgdbGame ? false : true);
    const currentSlug = effectiveRegistryGame?.slug ?? selectedIgdbGame?.slug ?? '';

    const { data: gameCharsData } = useMyCharacters(effectiveGameId, !!effectiveGameId);
    const gameChars = gameCharsData?.data ?? [];
    const hasMainForGame = gameChars.some((c) => c.isMain);

    if (isOpen && !prevIsOpen) {
        setPrevIsOpen(true);
        setResetKey((k) => k + 1);
        const initial = getInitialFormState(editingCharacter);
        if (!editingCharacter && !hasMainForGame) initial.isMain = true;
        setForm(initial);
        setError('');
        if (!editingCharacter) {
            if (preselectedGameId) {
                const match = registryGames.find((g) => g.id === preselectedGameId);
                if (match) setSelectedIgdbGame({ id: 0, igdbId: 0, name: match.name, slug: match.slug, coverUrl: null });
            } else { setSelectedIgdbGame(null); }
        }
    }
    if (!isOpen && prevIsOpen) setPrevIsOpen(false);

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) { setError('Character name is required'); return; }
        if (!effectiveGameId && !selectedIgdbGame) { setError('Please select a game'); return; }
        if (!effectiveGameId) { setError('This game is not registered in the system. Only a name can be set for generic characters.'); return; }

        if (isEditing && editingCharacter) {
            const needsSetMain = form.isMain && !editingCharacter.isMain;
            const doUpdate = () => {
                updateMutation.mutate({
                    id: editingCharacter.id,
                    dto: {
                        name: form.name.trim(),
                        class: showMmoFields ? (form.class.trim() || null) : null,
                        spec: showMmoFields ? (form.spec.trim() || null) : null,
                        roleOverride: showMmoFields ? (form.role || null) : null,
                        realm: showMmoFields ? (form.realm.trim() || null) : null,
                    },
                }, { onSuccess: () => onClose() });
            };
            if (needsSetMain) { setMainMutation.mutate(editingCharacter.id, { onSuccess: doUpdate }); }
            else { doUpdate(); }
        } else {
            createMutation.mutate({
                gameId: effectiveGameId!, name: form.name.trim(),
                class: showMmoFields ? (form.class.trim() || undefined) : undefined,
                spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
                role: showMmoFields ? (form.role || undefined) : undefined,
                realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
                isMain: form.isMain,
            }, {
                onSuccess: () => {
                    onClose();
                    setForm({ name: '', class: '', spec: '', role: '', realm: '', isMain: false });
                    setSelectedIgdbGame(null);
                },
            });
        }
    }

    const isPending = createMutation.isPending || updateMutation.isPending || setMainMutation.isPending;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Character' : 'Add Character'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {isEditing ? (
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">Game</label>
                        <div className="px-3 py-2 bg-panel/50 border border-edge/50 rounded-lg text-muted text-sm">{effectiveGameName}</div>
                    </div>
                ) : (
                    <GameSearchInput key={resetKey} value={selectedIgdbGame} onChange={(game) => setSelectedIgdbGame(game)}
                        error={error && !selectedIgdbGame && !effectiveGameId ? error : undefined} />
                )}

                {!isEditing && currentSlug && (
                    <PluginSlot name="character-create:import-form" context={{
                        onClose, gameSlug: currentSlug, activeTab, onTabChange: setActiveTab,
                        defaultIsMain: !hasMainForGame, existingCharacters: gameChars,
                    }} />
                )}

                {activeTab === 'manual' && (
                    <>
                        {(selectedIgdbGame || isEditing) && (
                            <CharacterFormFields
                                form={form} showMmoFields={showMmoFields} isArmorySynced={isArmorySynced}
                                isEditing={isEditing} editingIsMain={!!editingCharacter?.isMain}
                                hasMainForGame={hasMainForGame} onUpdateField={updateField}
                            />
                        )}

                        {error && <p className="text-sm text-red-400">{error}</p>}

                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={onClose}
                                className="px-4 py-2 text-secondary hover:text-foreground transition-colors">Cancel</button>
                            <button type="submit" disabled={isPending}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                                {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Character'}
                            </button>
                        </div>
                    </>
                )}
            </form>
        </Modal>
    );
}
