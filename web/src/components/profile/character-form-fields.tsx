import type { CharacterRole } from '@raid-ledger/contract';
import { LockClosedIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

interface FormState {
    name: string;
    class: string;
    spec: string;
    role: CharacterRole | '';
    realm: string;
    isMain: boolean;
}

interface CharacterFormFieldsProps {
    form: FormState;
    showMmoFields: boolean;
    isArmorySynced: boolean;
    isEditing: boolean;
    editingIsMain: boolean;
    hasMainForGame: boolean;
    onUpdateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}

const INPUT_BASE = 'w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500';
const ARMORY_TITLE = 'This field is synced from the Blizzard Armory';

function ArmorySyncBanner() {
    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-sm">
            <InformationCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span>This character is synced from the Blizzard Armory. Some fields are read-only.</span>
        </div>
    );
}

function SyncableInput({ label, value, onChange, placeholder, maxLength, isArmorySynced, required }: {
    label: string; value: string; onChange: (v: string) => void; placeholder: string; maxLength: number; isArmorySynced: boolean; required?: boolean;
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">
                {label} {required && <span className="text-red-400">*</span>}
                {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
            </label>
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder} maxLength={maxLength} disabled={isArmorySynced}
                title={isArmorySynced ? ARMORY_TITLE : undefined}
                className={`${INPUT_BASE} ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`} />
        </div>
    );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (v: CharacterRole | '') => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">Role</label>
            <select value={value} onChange={(e) => onChange(e.target.value as CharacterRole | '')}
                className={INPUT_BASE}>
                <option value="">Select role...</option>
                <option value="tank">Tank</option>
                <option value="healer">Healer</option>
                <option value="dps">DPS</option>
            </select>
        </div>
    );
}

function MainCheckbox({ form, isEditing, editingIsMain, hasMainForGame, onUpdateField }: {
    form: FormState; isEditing: boolean; editingIsMain: boolean; hasMainForGame: boolean;
    onUpdateField: CharacterFormFieldsProps['onUpdateField'];
}) {
    const disabled = (isEditing && editingIsMain) || (!isEditing && !hasMainForGame);
    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isMain} onChange={(e) => onUpdateField('isMain', e.target.checked)}
                disabled={disabled} className="w-4 h-4 rounded border-edge-strong bg-panel text-emerald-500 focus:ring-emerald-500 disabled:opacity-50" />
            <span className={`text-sm ${disabled ? 'text-muted' : 'text-secondary'}`}>
                Main character
                {isEditing && editingIsMain && <span className="ml-1 text-xs text-muted">(already main)</span>}
                {!isEditing && !hasMainForGame && <span className="ml-1 text-xs text-muted">(no main set)</span>}
            </span>
        </label>
    );
}

export function CharacterFormFields({
    form, showMmoFields, isArmorySynced, isEditing, editingIsMain, hasMainForGame, onUpdateField,
}: CharacterFormFieldsProps) {
    return (
        <>
            {isArmorySynced && <ArmorySyncBanner />}
            <SyncableInput label="Name" value={form.name} onChange={(v) => onUpdateField('name', v)}
                placeholder="Character name" maxLength={100} isArmorySynced={isArmorySynced} required />
            {showMmoFields && (
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <SyncableInput label="Class" value={form.class} onChange={(v) => onUpdateField('class', v)}
                            placeholder="e.g. Warrior" maxLength={50} isArmorySynced={isArmorySynced} />
                        <SyncableInput label="Spec" value={form.spec} onChange={(v) => onUpdateField('spec', v)}
                            placeholder="e.g. Arms" maxLength={50} isArmorySynced={isArmorySynced} />
                    </div>
                    <RoleSelect value={form.role} onChange={(v) => onUpdateField('role', v)} />
                    <SyncableInput label="Realm/Server" value={form.realm} onChange={(v) => onUpdateField('realm', v)}
                        placeholder="e.g. Illidan" maxLength={100} isArmorySynced={isArmorySynced} />
                </>
            )}
            <MainCheckbox form={form} isEditing={isEditing} editingIsMain={editingIsMain}
                hasMainForGame={hasMainForGame} onUpdateField={onUpdateField} />
        </>
    );
}
