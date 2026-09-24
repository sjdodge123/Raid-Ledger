import { useState, useMemo } from 'react';
import type { CharacterRole, CharacterDto, IgdbGameDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
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

/** Where each validation/save message renders (ROK-1648 ruling 8): name → Field, game → search, form → alert. */
interface FormErrors { name?: string; game?: string; form?: string }

const getInitialFormState = (char?: CharacterDto | null): FormState => ({
    name: char?.name ?? '', class: char?.class ?? '', spec: char?.spec ?? '',
    role: char?.role ?? '', realm: char?.realm ?? '', isMain: char?.isMain ?? false,
});

function buildUpdateDto(form: FormState, showMmoFields: boolean) {
    return {
        name: form.name.trim(),
        class: showMmoFields ? (form.class.trim() || null) : null,
        spec: showMmoFields ? (form.spec.trim() || null) : null,
        roleOverride: showMmoFields ? (form.role || null) : null,
        realm: showMmoFields ? (form.realm.trim() || null) : null,
    };
}

function buildCreateDto(form: FormState, showMmoFields: boolean, gameId: number) {
    return {
        gameId, name: form.name.trim(),
        class: showMmoFields ? (form.class.trim() || undefined) : undefined,
        spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
        role: showMmoFields ? (form.role || undefined) : undefined,
        realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
        isMain: form.isMain,
    };
}

/** Game first: the Name field only renders once a game is picked, so its error would be invisible before that. */
function validateCharacterForm(form: FormState, effectiveGameId: number | undefined, selectedIgdbGame: IgdbGameDto | null): FormErrors | null {
    if (!effectiveGameId && !selectedIgdbGame) return { game: 'Please select a game' };
    if (!form.name.trim()) return { name: 'Character name is required' };
    if (!effectiveGameId) return { form: 'This game is not registered in the system. Only a name can be set for generic characters.' };
    return null;
}

function CharacterFormActions({ onClose, isPending, isEditing }: { onClose: () => void; isPending: boolean; isEditing: boolean }) {
    return (
        <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={isPending} loadingLabel="Saving…">
                {isEditing ? 'Save Changes' : 'Add Character'}
            </Button>
        </div>
    );
}

function useCharacterModalMutations() {
    const createMutation = useCreateCharacter();
    const updateMutation = useUpdateCharacter();
    const setMainMutation = useSetMainCharacter();
    const isPending = createMutation.isPending || updateMutation.isPending || setMainMutation.isPending;
    return { createMutation, updateMutation, setMainMutation, isPending };
}

function useCharacterModalRegistryLookup(selectedIgdbGame: IgdbGameDto | null, preselectedGameId?: number) {
    const { games: registryGames } = useGameRegistry();
    const registryGame = useMemo(() => {
        if (!selectedIgdbGame) return undefined;
        return registryGames.find((g) => g.name.toLowerCase() === selectedIgdbGame.name.toLowerCase() || g.slug === selectedIgdbGame.slug);
    }, [selectedIgdbGame, registryGames]);
    const preselectedRegistryGame = useMemo(() => {
        if (!preselectedGameId) return undefined;
        return registryGames.find((g) => g.id === preselectedGameId);
    }, [preselectedGameId, registryGames]);
    return { registryGames, registryGame, preselectedRegistryGame };
}

interface ModalResetState {
    setForm: React.Dispatch<React.SetStateAction<FormState>>; setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
    setResetKey: React.Dispatch<React.SetStateAction<number>>; setSelectedIgdbGame: React.Dispatch<React.SetStateAction<IgdbGameDto | null>>;
    setPrevIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

function syncModalOpenClose(
    isOpen: boolean, prevIsOpen: boolean, editingCharacter: CharacterDto | null | undefined,
    hasMainForGame: boolean, preselectedGameId: number | undefined,
    registryGames: { id: number; name: string; slug: string }[], rs: ModalResetState,
) {
    if (isOpen && !prevIsOpen) {
        rs.setPrevIsOpen(true); rs.setResetKey((k) => k + 1);
        const initial = getInitialFormState(editingCharacter);
        if (!editingCharacter && !hasMainForGame) initial.isMain = true;
        rs.setForm(initial); rs.setErrors({});
        if (!editingCharacter) {
            if (preselectedGameId) { const match = registryGames.find((g) => g.id === preselectedGameId); if (match) rs.setSelectedIgdbGame({ id: 0, igdbId: 0, name: match.name, slug: match.slug, coverUrl: null }); }
            else { rs.setSelectedIgdbGame(null); }
        }
    }
    if (!isOpen && prevIsOpen) rs.setPrevIsOpen(false);
}

function useCharacterModalState(props: AddCharacterModalProps) {
    const { isOpen, onClose, gameId: preselectedGameId, editingCharacter } = props;
    const mutations = useCharacterModalMutations();
    const [selectedIgdbGame, setSelectedIgdbGame] = useState<IgdbGameDto | null>(null);
    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [form, setForm] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [errors, setErrors] = useState<FormErrors>({});
    const { registryGames, registryGame, preselectedRegistryGame } = useCharacterModalRegistryLookup(selectedIgdbGame, preselectedGameId);
    const isEditing = !!editingCharacter;
    const effectiveRegistryGame = isEditing ? preselectedRegistryGame : registryGame;
    const effectiveGameId = effectiveRegistryGame?.id ?? preselectedGameId;
    const showMmoFields = effectiveRegistryGame?.hasRoles ?? (selectedIgdbGame ? false : true);
    const { data: gameCharsData } = useMyCharacters(effectiveGameId, !!effectiveGameId);
    const gameChars = gameCharsData?.data ?? [];
    const hasMainForGame = gameChars.some((c) => c.isMain);
    syncModalOpenClose(isOpen, prevIsOpen, editingCharacter, hasMainForGame, preselectedGameId, registryGames, { setForm, setErrors, setResetKey, setSelectedIgdbGame, setPrevIsOpen });
    const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [field]: value }));

    return { form, errors, setErrors, selectedIgdbGame, setSelectedIgdbGame, activeTab, setActiveTab, resetKey, effectiveRegistryGame, effectiveGameId, showMmoFields, gameChars, hasMainForGame, isEditing, ...mutations, updateField, onClose };
}

function handleCharacterSubmit(s: ReturnType<typeof useCharacterModalState>, editingCharacter: CharacterDto | null | undefined, onClose: () => void) {
    s.setErrors({});
    const errs = validateCharacterForm(s.form, s.effectiveGameId, s.selectedIgdbGame);
    if (errs) { s.setErrors(errs); return; }
    // A failed save is a form-level alert (the hooks also toast it).
    const onError = (e: Error) => s.setErrors({ form: e.message || 'Failed to save character' });
    if (s.isEditing && editingCharacter) {
        const needsSetMain = s.form.isMain && !editingCharacter.isMain;
        const doUpdate = () => s.updateMutation.mutate({ id: editingCharacter.id, dto: buildUpdateDto(s.form, s.showMmoFields) }, { onSuccess: () => onClose(), onError });
        if (needsSetMain) s.setMainMutation.mutate(editingCharacter.id, { onSuccess: doUpdate, onError });
        else doUpdate();
    } else {
        s.createMutation.mutate(buildCreateDto(s.form, s.showMmoFields, s.effectiveGameId!), { onSuccess: () => { onClose(); s.setSelectedIgdbGame(null); }, onError });
    }
}

function CharacterModalFormBody({ s, editingCharacter, onClose, effectiveGameName, currentSlug, isArmorySynced }: {
    s: ReturnType<typeof useCharacterModalState>; editingCharacter?: CharacterDto | null;
    onClose: () => void; effectiveGameName: string; currentSlug: string; isArmorySynced: boolean;
}) {
    return (
        <form onSubmit={(e) => { e.preventDefault(); handleCharacterSubmit(s, editingCharacter, onClose); }} className="space-y-4">
            {s.isEditing ? (
                <div><p className="mb-1.5 text-sm font-medium text-secondary">Game</p><div className="px-3 py-2 bg-panel/50 border border-edge/50 rounded-lg text-muted text-sm">{effectiveGameName}</div></div>
            ) : (
                <GameSearchInput key={s.resetKey} value={s.selectedIgdbGame} onChange={(game) => s.setSelectedIgdbGame(game)}
                    error={s.errors.game} />
            )}
            {!s.isEditing && currentSlug && (
                <PluginSlot name="character-create:import-form" context={{ onClose, gameSlug: currentSlug, activeTab: s.activeTab, onTabChange: s.setActiveTab, defaultIsMain: !s.hasMainForGame, existingCharacters: s.gameChars }} />
            )}
            {s.activeTab === 'manual' && (
                <>
                    {(s.selectedIgdbGame || s.isEditing) && (
                        <CharacterFormFields form={s.form} showMmoFields={s.showMmoFields} isArmorySynced={isArmorySynced}
                            isEditing={s.isEditing} editingIsMain={!!editingCharacter?.isMain} hasMainForGame={s.hasMainForGame}
                            nameError={s.errors.name} onUpdateField={s.updateField} />
                    )}
                    {s.errors.form && <p role="alert" className="text-sm text-danger">{s.errors.form}</p>}
                    <CharacterFormActions onClose={onClose} isPending={s.isPending} isEditing={s.isEditing} />
                </>
            )}
        </form>
    );
}

export function AddCharacterModal(props: AddCharacterModalProps) {
    const { isOpen, onClose, gameName: preselectedGameName, editingCharacter } = props;
    const s = useCharacterModalState(props);
    const isArmorySynced = !!editingCharacter?.lastSyncedAt;
    const currentSlug = s.effectiveRegistryGame?.slug ?? s.selectedIgdbGame?.slug ?? '';
    const effectiveGameName = s.effectiveRegistryGame?.name ?? preselectedGameName ?? s.selectedIgdbGame?.name ?? 'Unknown Game';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={s.isEditing ? 'Edit Character' : 'Add Character'}>
            <CharacterModalFormBody s={s} editingCharacter={editingCharacter} onClose={onClose}
                effectiveGameName={effectiveGameName} currentSlug={currentSlug} isArmorySynced={isArmorySynced} />
        </Modal>
    );
}
