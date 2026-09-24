import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { CharacterRole, GameRegistryDto, CharacterDto } from '@raid-ledger/contract';
import { useCreateCharacter, useDeleteCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';
import { PluginSlot } from '../../plugins';
import { CharacterCardCompact } from '../characters/character-card-compact';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

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

/** A missing name is a Field error on Name; a failed create is a separate form-level alert (ROK-1648). */
interface StepErrors { name?: string; submit?: string }

const EMPTY_FORM: FormState = { name: '', class: '', spec: '', role: '', realm: '' };

type UpdateField = <K extends keyof FormState>(f: K, v: FormState[K]) => void;

function buildCharacterPayload(form: FormState, gameId: number, showMmoFields: boolean, isMain: boolean) {
    return {
        gameId,
        name: form.name.trim(),
        class: showMmoFields ? (form.class.trim() || undefined) : undefined,
        spec: showMmoFields ? (form.spec.trim() || undefined) : undefined,
        role: showMmoFields ? (form.role || undefined) : undefined,
        realm: showMmoFields ? (form.realm.trim() || undefined) : undefined,
        isMain,
    };
}

function SavedCharacterView({ savedCharacter, onDelete, isDeleting, onAddAnother }: {
    savedCharacter: CharacterDto; onDelete: (id: string) => void; isDeleting: boolean; onAddAnother?: () => void;
}) {
    return (
        <div className="max-w-md mx-auto space-y-3">
            <div className="relative">
                <CharacterCardCompact character={savedCharacter} size="sm" />
                <div className="absolute top-1 right-1">
                    <Button variant="destructive-soft" iconOnly aria-label="Remove character" onClick={() => onDelete(savedCharacter.id)} disabled={isDeleting}>
                        <XMarkIcon className="w-4 h-4" aria-hidden="true" />
                    </Button>
                </div>
            </div>
            <Button variant="secondary" fullWidth onClick={onAddAnother}>+ Add Another Character</Button>
        </div>
    );
}

function TextField({ label, field, form, updateField, placeholder, maxLength }: {
    label: string; field: 'class' | 'spec' | 'realm'; form: FormState; updateField: UpdateField; placeholder: string; maxLength: number;
}) {
    return (
        <Field label={label}>
            <Input type="text" value={form[field]} onChange={(e) => updateField(field, e.target.value)} placeholder={placeholder} maxLength={maxLength} />
        </Field>
    );
}

function MmoFields({ form, updateField }: { form: FormState; updateField: UpdateField }) {
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Class" field="class" form={form} updateField={updateField} placeholder="e.g. Warrior" maxLength={50} />
                <TextField label="Spec" field="spec" form={form} updateField={updateField} placeholder="e.g. Arms" maxLength={50} />
            </div>
            <Field label="Role">
                <Select value={form.role} onChange={(e) => updateField('role', e.target.value as CharacterRole | '')} placeholder="Select role...">
                    <option value="tank">Tank</option><option value="healer">Healer</option><option value="dps">DPS</option>
                </Select>
            </Field>
            <TextField label="Realm/Server" field="realm" form={form} updateField={updateField} placeholder="e.g. Illidan" maxLength={100} />
        </>
    );
}

function useCharacterStepState(preselectedGame: GameRegistryDto) {
    const createMutation = useCreateCharacter();
    const deleteMutation = useDeleteCharacter();
    const { data: myCharsData } = useMyCharacters(preselectedGame.id);
    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [errors, setErrors] = useState<StepErrors>({});
    const existingChars = myCharsData?.data ?? [];
    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) { setForm((prev) => ({ ...prev, [field]: value })); }
    function resetForm() { setForm(EMPTY_FORM); setErrors({}); setActiveTab('manual'); }
    return { createMutation, deleteMutation, activeTab, setActiveTab, form, errors, setErrors, existingChars, updateField, resetForm };
}

/** Step: Create a Character for a specific game. */
export function CharacterStep({ preselectedGame, charIndex, onRegisterValidator, onAddAnother, onRemoveStep }: CharacterStepProps) {
    const s = useCharacterStepState(preselectedGame);
    const savedCharacter = s.existingChars[charIndex] ?? null;
    const handleDelete = (id: string) => { s.deleteMutation.mutate(id, { onSuccess: () => { if (charIndex > 0) onRemoveStep?.(); } }); };
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault(); s.setErrors({});
        if (!s.form.name.trim()) { s.setErrors({ name: 'Character name is required' }); return; }
        s.createMutation.mutate(buildCharacterPayload(s.form, preselectedGame.id, preselectedGame.hasRoles, s.existingChars.length === 0), { onSuccess: () => s.resetForm(), onError: () => s.setErrors({ submit: 'Failed to create character. Please try again.' }) });
    };

    return (
        <div className="space-y-4">
            <div className="text-center">
                <h2 className="text-xl font-bold text-foreground">Create a Character — {preselectedGame.name}</h2>
                <p className="text-muted text-sm mt-1">You can always add more from your profile later.</p>
            </div>
            {savedCharacter ? <SavedCharacterView savedCharacter={savedCharacter} onDelete={handleDelete} isDeleting={s.deleteMutation.isPending} onAddAnother={onAddAnother} /> : (
                <CharacterStepForm s={s} preselectedGame={preselectedGame} onRegisterValidator={onRegisterValidator} handleSubmit={handleSubmit} />
            )}
        </div>
    );
}

function CharacterStepForm({ s, preselectedGame, onRegisterValidator, handleSubmit }: {
    s: ReturnType<typeof useCharacterStepState>; preselectedGame: GameRegistryDto;
    onRegisterValidator?: (fn: () => boolean) => void; handleSubmit: (e: React.FormEvent) => void;
}) {
    return (
        <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4">
            {preselectedGame.slug && <PluginSlot name="character-create:import-form" context={{ onClose: () => {}, gameSlug: preselectedGame.slug, activeTab: s.activeTab, onTabChange: s.setActiveTab, existingCharacters: s.existingChars, onRegisterValidator }} />}
            {s.activeTab === 'manual' && (
                <>
                    <Field label="Name" required error={s.errors.name}>
                        <Input type="text" value={s.form.name} onChange={(e) => s.updateField('name', e.target.value)} placeholder="Character name" maxLength={100} />
                    </Field>
                    {preselectedGame.hasRoles && <MmoFields form={s.form} updateField={s.updateField} />}
                    {s.errors.submit && <p role="alert" className="text-sm text-danger">{s.errors.submit}</p>}
                    <Button type="submit" variant="primary" fullWidth loading={s.createMutation.isPending} loadingLabel="Creating…">Create Character</Button>
                </>
            )}
        </form>
    );
}
