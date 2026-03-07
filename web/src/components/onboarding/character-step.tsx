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

const FIELD_CLS = 'w-full px-3 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm';

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
    savedCharacter: { id: string }; onDelete: (id: string) => void; isDeleting: boolean; onAddAnother?: () => void;
}) {
    return (
        <div className="max-w-md mx-auto space-y-3">
            <div className="relative">
                <CharacterCardCompact character={savedCharacter} size="sm" />
                <button type="button" onClick={() => onDelete(savedCharacter.id)} disabled={isDeleting} title="Remove character"
                    className="absolute top-1 right-1 w-10 h-10 flex items-center justify-center rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 transition-colors disabled:opacity-40">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <button type="button" onClick={onAddAnother} className="w-full px-4 py-2.5 min-h-[44px] bg-panel hover:bg-overlay text-muted hover:text-foreground border border-edge/50 rounded-lg transition-colors text-sm">+ Add Another Character</button>
        </div>
    );
}

function MmoFields({ form, updateField }: { form: FormState; updateField: <K extends keyof FormState>(f: K, v: FormState[K]) => void }) {
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-foreground mb-1">Class</label><input type="text" value={form.class} onChange={(e) => updateField('class', e.target.value)} placeholder="e.g. Warrior" maxLength={50} className={FIELD_CLS} /></div>
                <div><label className="block text-sm font-medium text-foreground mb-1">Spec</label><input type="text" value={form.spec} onChange={(e) => updateField('spec', e.target.value)} placeholder="e.g. Arms" maxLength={50} className={FIELD_CLS} /></div>
            </div>
            <div><label className="block text-sm font-medium text-foreground mb-1">Role</label>
                <select value={form.role} onChange={(e) => updateField('role', e.target.value as CharacterRole | '')} className={FIELD_CLS}>
                    <option value="">Select role...</option><option value="tank">Tank</option><option value="healer">Healer</option><option value="dps">DPS</option>
                </select>
            </div>
            <div><label className="block text-sm font-medium text-foreground mb-1">Realm/Server</label><input type="text" value={form.realm} onChange={(e) => updateField('realm', e.target.value)} placeholder="e.g. Illidan" maxLength={100} className={FIELD_CLS} /></div>
        </>
    );
}

function useCharacterStepState(preselectedGame: GameRegistryDto) {
    const createMutation = useCreateCharacter();
    const deleteMutation = useDeleteCharacter();
    const { data: myCharsData } = useMyCharacters(preselectedGame.id);
    const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual');
    const [form, setForm] = useState<FormState>({ name: '', class: '', spec: '', role: '', realm: '' });
    const [error, setError] = useState('');
    const existingChars = myCharsData?.data ?? [];
    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) { setForm((prev) => ({ ...prev, [field]: value })); }
    function resetForm() { setForm({ name: '', class: '', spec: '', role: '', realm: '' }); setError(''); setActiveTab('manual'); }
    return { createMutation, deleteMutation, activeTab, setActiveTab, form, error, setError, existingChars, updateField, resetForm };
}

/** Step: Create a Character for a specific game. */
export function CharacterStep({ preselectedGame, charIndex, onRegisterValidator, onAddAnother, onRemoveStep }: CharacterStepProps) {
    const s = useCharacterStepState(preselectedGame);
    const savedCharacter = s.existingChars[charIndex] ?? null;
    const handleDelete = (id: string) => { s.deleteMutation.mutate(id, { onSuccess: () => { if (charIndex > 0) onRemoveStep?.(); } }); };
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault(); s.setError('');
        if (!s.form.name.trim()) { s.setError('Character name is required'); return; }
        s.createMutation.mutate(buildCharacterPayload(s.form, preselectedGame.id, preselectedGame.hasRoles, s.existingChars.length === 0), { onSuccess: () => s.resetForm(), onError: () => s.setError('Failed to create character. Please try again.') });
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
                    <div><label className="block text-sm font-medium text-foreground mb-1">Name <span className="text-red-400">*</span></label><input type="text" value={s.form.name} onChange={(e) => s.updateField('name', e.target.value)} placeholder="Character name" maxLength={100} className={FIELD_CLS} /></div>
                    {preselectedGame.hasRoles && <MmoFields form={s.form} updateField={s.updateField} />}
                    {s.error && <p className="text-sm text-red-400">{s.error}</p>}
                    <button type="submit" disabled={s.createMutation.isPending} className="w-full px-4 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-white font-medium rounded-lg transition-colors text-sm">{s.createMutation.isPending ? 'Creating...' : 'Create Character'}</button>
                </>
            )}
        </form>
    );
}
