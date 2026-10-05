import { useState, useMemo, useId } from 'react';
import type { CharacterRole, CharacterDto, IgdbGameDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { useCreateCharacter, useUpdateCharacter, useSetMainCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';
import { useGameRegistry } from '../../hooks/use-game-registry';
import { GameSearchInput } from '../events/game-search-input';
import { PluginSlot } from '../../plugins';
import { isConflictError } from '../../lib/api/api-error';
import { CharacterFormFields } from './character-form-fields';
import { useCharacterIdentity, type CharacterIdentityProvider, type IdentityErrors } from '../../plugins/character-identity';

interface AddCharacterModalProps {
    isOpen: boolean;
    onClose: () => void;
    gameId?: number | undefined;
    gameName?: string | undefined;
    editingCharacter?: CharacterDto | null;
}

interface FormState {
    name: string;
    class: string;
    spec: string;
    role: CharacterRole | '';
    realm: string;
    isMain: boolean;
    /** Plugin-owned identity value (ROK-1733): undefined until edited, then the provider's own shape. */
    identity: unknown;
}

/** Where each validation/save message renders (ROK-1648 ruling 8): name → Field, game → search, form → alert. */
interface FormErrors { name?: string; game?: string; form?: string; identity?: IdentityErrors }

const getInitialFormState = (char?: CharacterDto | null): FormState => ({
    name: char?.name ?? '', class: char?.class ?? '', spec: char?.spec ?? '',
    role: char?.role ?? '', realm: char?.realm ?? '', isMain: char?.isMain ?? false,
    identity: undefined,
});

type Identity = CharacterIdentityProvider | null;

/** The identity value a form holds: the user's edit, else the provider's value for the edited character (blank on create). */
function resolveIdentity(identity: Identity, value: unknown, editing?: CharacterDto | null): unknown {
    return identity && value === undefined ? identity.fromCharacter(editing) : value;
}

/**
 * ROK-1655: unsaved = a field differs from the state the form opened with
 * (`getInitialFormState(editing)`, plus the open-time Main default for a new
 * character), OR a new character has a game picked that was not preselected.
 * A search query alone never reaches here, so it is not dirty.
 */
function isCharacterFormDirty(form: FormState, baseline: FormState, sameIdentity: (a: unknown, b: unknown) => boolean, pickedGameSlug: string | undefined, preselectedSlug: string | undefined): boolean {
    const changed = (Object.keys(baseline) as (keyof FormState)[])
        .some((k) => (k === 'identity' ? !sameIdentity(form.identity, baseline.identity) : form[k] !== baseline[k]));
    return changed || (pickedGameSlug !== undefined && pickedGameSlug !== preselectedSlug);
}

function buildUpdateDto(form: FormState, showMmoFields: boolean, identity: Identity, identityValue: unknown) {
    const dto = buildBaseUpdateDto(form, showMmoFields);
    return identity ? { ...dto, realm: undefined, ...identity.updateFields(identityValue) } : dto;
}

function buildBaseUpdateDto(form: FormState, showMmoFields: boolean) {
    return {
        name: form.name.trim(),
        class: showMmoFields ? (form.class.trim() || null) : null,
        spec: showMmoFields ? (form.spec.trim() || null) : null,
        roleOverride: showMmoFields ? (form.role || null) : null,
        realm: showMmoFields ? (form.realm.trim() || null) : null,
    };
}

/** A plugin-owned identity replaces the name with its own fields and never sends a realm. */
function buildCreateDto(form: FormState, showMmoFields: boolean, gameId: number, identity: Identity, identityValue: unknown) {
    const dto = buildBaseCreateDto(form, showMmoFields, gameId);
    return identity ? { ...dto, realm: undefined, ...identity.createFields(identityValue) } : dto;
}

function buildBaseCreateDto(form: FormState, showMmoFields: boolean, gameId: number) {
    return {
        gameId, name: form.name.trim(),
        class: showMmoFields ? (form.class.trim() || undefined) : undefined,
        spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
        role: showMmoFields ? (form.role || undefined) : undefined,
        realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
        isMain: form.isMain,
    };
}

/**
 * Game first: the Name field only renders once a game is picked, so its error would be invisible before that.
 * Every path — a plugin-owned identity included — needs a resolved registry game id; the narrowed id is returned for the save.
 */
function validateCharacterForm(form: FormState, effectiveGameId: number | undefined, selectedIgdbGame: IgdbGameDto | null, identity: Identity, identityValue: unknown): { errors: FormErrors } | { gameId: number } {
    if (!effectiveGameId && !selectedIgdbGame) return { errors: { game: 'Please select a game' } };
    if (identity) { const errs = identity.validate(identityValue); if (errs) return { errors: { identity: errs } }; }
    else if (!form.name.trim()) return { errors: { name: 'Character name is required' } };
    if (!effectiveGameId) return { errors: { form: 'This game is not registered in the system. Only a name can be set for generic characters.' } };
    return { gameId: effectiveGameId };
}

/** Pinned in the Modal footer (ROK-1655): the submit reaches the form by id; Cancel goes through the guard. */
function CharacterFormActions({ formId, onCancel, isPending, isEditing }: { formId: string; onCancel: () => void; isPending: boolean; isEditing: boolean }) {
    return (
        <>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary" loading={isPending} loadingLabel="Saving…">
                {isEditing ? 'Save Changes' : 'Add Character'}
            </Button>
        </>
    );
}

// A 409 (name already claimed) is shown inline by the form, so its toast is suppressed.
const CONFLICT_SHOWN_INLINE = { isHandledError: isConflictError };

function useCharacterModalMutations() {
    const createMutation = useCreateCharacter(CONFLICT_SHOWN_INLINE);
    const updateMutation = useUpdateCharacter(CONFLICT_SHOWN_INLINE);
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
    setForm: React.Dispatch<React.SetStateAction<FormState>>; setBaseline: React.Dispatch<React.SetStateAction<FormState>>; setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
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
        rs.setForm(initial); rs.setBaseline(initial); rs.setErrors({});
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
    const [baseline, setBaseline] = useState<FormState>(() => getInitialFormState(editingCharacter));
    const [errors, setErrors] = useState<FormErrors>({});
    const { registryGames, registryGame, preselectedRegistryGame } = useCharacterModalRegistryLookup(selectedIgdbGame, preselectedGameId);
    const isEditing = !!editingCharacter;
    const effectiveRegistryGame = isEditing ? preselectedRegistryGame : registryGame;
    const effectiveGameId = effectiveRegistryGame?.id ?? preselectedGameId;
    // ROK-1733: an active plugin may own the picked (or edited) game's identity fields.
    const identity = useCharacterIdentity(effectiveRegistryGame?.slug ?? selectedIgdbGame?.slug, editingCharacter);
    const identityValue = resolveIdentity(identity, form.identity, editingCharacter);
    const sameIdentity = (a: unknown, b: unknown) => (identity ? identity.same(resolveIdentity(identity, a, editingCharacter), resolveIdentity(identity, b, editingCharacter)) : a === b);
    const showMmoFields = effectiveRegistryGame?.hasRoles ?? (selectedIgdbGame ? false : true);
    const { data: gameCharsData } = useMyCharacters(effectiveGameId, !!effectiveGameId);
    const gameChars = gameCharsData?.data ?? [];
    const hasMainForGame = gameChars.some((c) => c.isMain);
    syncModalOpenClose(isOpen, prevIsOpen, editingCharacter, hasMainForGame, preselectedGameId, registryGames, { setForm, setBaseline, setErrors, setResetKey, setSelectedIgdbGame, setPrevIsOpen });
    const isDirty = isCharacterFormDirty(form, baseline, sameIdentity, isEditing ? undefined : selectedIgdbGame?.slug, preselectedRegistryGame?.slug);
    const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [field]: value }));

    return { form, errors, setErrors, selectedIgdbGame, setSelectedIgdbGame, activeTab, setActiveTab, resetKey, effectiveRegistryGame, effectiveGameId, showMmoFields, identity, identityValue, gameChars, hasMainForGame, isEditing, isDirty, ...mutations, updateField, onClose };
}

/**
 * A failed save is a form alert, shown once: a plugin-identity 409 sits under
 * the name row it concerns (its toast is suppressed); anything else stays a
 * form-level alert and the hooks also toast it.
 */
function saveErrorToFormErrors(e: Error, identity: Identity): FormErrors {
    const message = e.message || 'Failed to save character';
    return identity && isConflictError(e) ? { identity: { name: message } } : { form: message };
}

function handleCharacterSubmit(s: ReturnType<typeof useCharacterModalState>, editingCharacter: CharacterDto | null | undefined, onClose: () => void) {
    s.setErrors({});
    const result = validateCharacterForm(s.form, s.effectiveGameId, s.selectedIgdbGame, s.identity, s.identityValue);
    if ('errors' in result) { s.setErrors(result.errors); return; }
    const onError = (e: Error) => s.setErrors(saveErrorToFormErrors(e, s.identity));
    if (s.isEditing && editingCharacter) {
        const needsSetMain = s.form.isMain && !editingCharacter.isMain;
        const doUpdate = () => s.updateMutation.mutate({ id: editingCharacter.id, dto: buildUpdateDto(s.form, s.showMmoFields, s.identity, s.identityValue) }, { onSuccess: () => onClose(), onError });
        if (needsSetMain) s.setMainMutation.mutate(editingCharacter.id, { onSuccess: doUpdate, onError });
        else doUpdate();
    } else {
        s.createMutation.mutate(buildCreateDto(s.form, s.showMmoFields, result.gameId, s.identity, s.identityValue), { onSuccess: () => { onClose(); s.setSelectedIgdbGame(null); }, onError });
    }
}

function CharacterModalFormBody({ formId, s, editingCharacter, onClose, effectiveGameName, currentSlug, isArmorySynced }: {
    formId: string; s: ReturnType<typeof useCharacterModalState>; editingCharacter?: CharacterDto | null | undefined;
    onClose: () => void; effectiveGameName: string; currentSlug: string; isArmorySynced: boolean;
}) {
    return (
        <form id={formId} onSubmit={(e) => { e.preventDefault(); handleCharacterSubmit(s, editingCharacter, onClose); }} className="space-y-4">
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
                            nameError={s.errors.name} identity={s.identity} identityValue={s.identityValue} identityErrors={s.errors.identity} onUpdateField={s.updateField} />
                    )}
                    {s.errors.form && <p role="alert" className="text-sm text-danger">{s.errors.form}</p>}
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
    const formId = useId();
    // Escape, backdrop, × and Cancel ask first when dirty; a successful save calls onClose directly.
    const guard = useDirtyCloseGuard(s.isDirty, onClose);
    // The WoW Import tab keeps its plugin actions in the body, so the footer is Manual-only.
    const footer = s.activeTab === 'manual'
        && <CharacterFormActions formId={formId} onCancel={guard.requestClose} isPending={s.isPending} isEditing={s.isEditing} />;

    return (
        <Modal isOpen={isOpen} onClose={onClose} closeGuard={guard} footer={footer} title={s.isEditing ? 'Edit Character' : 'Add Character'}>
            <CharacterModalFormBody formId={formId} s={s} editingCharacter={editingCharacter} onClose={onClose}
                effectiveGameName={effectiveGameName} currentSlug={currentSlug} isArmorySynced={isArmorySynced} />
        </Modal>
    );
}
