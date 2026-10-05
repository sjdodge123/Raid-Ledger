import type { CharacterRole } from '@raid-ledger/contract';
import { LockClosedIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import type { CharacterIdentityProvider, IdentityErrors } from '../../plugins/character-identity';

interface FormState {
    name: string;
    class: string;
    spec: string;
    role: CharacterRole | '';
    realm: string;
    isMain: boolean;
    /** ROK-1733: plugin-owned identity value (used only with an `identity` provider). */
    identity: unknown;
}

interface CharacterFormFieldsProps {
    form: FormState;
    showMmoFields: boolean;
    isArmorySynced: boolean;
    isEditing: boolean;
    editingIsMain: boolean;
    hasMainForGame: boolean;
    /** Inline error on the Name field (e.g. 'Character name is required'). */
    nameError?: string | undefined;
    /** ROK-1733: an active plugin's identity provider swaps Name (and maybe Realm) for its own fields. */
    identity?: CharacterIdentityProvider | null | undefined;
    identityValue?: unknown;
    identityErrors?: IdentityErrors | undefined;
    onUpdateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}

const ARMORY_TITLE = 'This field is synced from the Blizzard Armory';

function ArmorySyncBanner() {
    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-overlay/30 border border-edge rounded-lg text-secondary text-sm">
            <InformationCircleIcon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>This character is synced from the Blizzard Armory. Some fields are read-only.</span>
        </div>
    );
}

/** The lock hint on a read-only, Armory-synced field (Field's label is a string, so the icon lives here). */
const ARMORY_LOCK_HINT = (
    <span className="inline-flex items-center gap-1">
        <LockClosedIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
        Synced from Armory
    </span>
);

function SyncableInput({ label, value, onChange, placeholder, maxLength, isArmorySynced, required, error }: {
    label: string; value: string; onChange: (v: string) => void; placeholder: string; maxLength: number;
    isArmorySynced: boolean; required?: boolean | undefined; error?: string | undefined;
}) {
    return (
        <Field label={label} required={required} error={error} hint={isArmorySynced ? ARMORY_LOCK_HINT : undefined}>
            <Input type="text" value={value} onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder} maxLength={maxLength} disabled={isArmorySynced}
                title={isArmorySynced ? ARMORY_TITLE : undefined} />
        </Field>
    );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (v: CharacterRole | '') => void }) {
    return (
        <Field label="Role">
            <Select value={value} onChange={(e) => onChange(e.target.value as CharacterRole | '')} placeholder="Select role...">
                <option value="tank">Tank</option>
                <option value="healer">Healer</option>
                <option value="dps">DPS</option>
            </Select>
        </Field>
    );
}

function mainNote(isEditing: boolean, editingIsMain: boolean, hasMainForGame: boolean): string | undefined {
    if (isEditing && editingIsMain) return '(already main)';
    if (!isEditing && !hasMainForGame) return '(no main set)';
    return undefined;
}

function MainCheckbox({ form, isEditing, editingIsMain, hasMainForGame, onUpdateField }: {
    form: FormState; isEditing: boolean; editingIsMain: boolean; hasMainForGame: boolean;
    onUpdateField: CharacterFormFieldsProps['onUpdateField'];
}) {
    const disabled = (isEditing && editingIsMain) || (!isEditing && !hasMainForGame);
    return (
        <Checkbox label="Main character" description={mainNote(isEditing, editingIsMain, hasMainForGame)}
            checked={form.isMain} onChange={(e) => onUpdateField('isMain', e.target.checked)} disabled={disabled} />
    );
}

/** Name — or a plugin's identity fields, with their creation-fixed parts locked when editing (ROK-1733). */
function IdentityFields({ form, identity, identityValue, isEditing, isArmorySynced, nameError, identityErrors, onUpdateField }: {
    form: FormState; identity?: CharacterIdentityProvider | null | undefined; identityValue: unknown; isEditing: boolean; isArmorySynced: boolean;
    nameError?: string | undefined; identityErrors?: IdentityErrors | undefined; onUpdateField: CharacterFormFieldsProps['onUpdateField'];
}) {
    if (identity) {
        const { Fields } = identity;
        return <Fields value={identityValue} onChange={(v) => onUpdateField('identity', v)} errors={identityErrors} regionLocked={isEditing} />;
    }
    return (
        <SyncableInput label="Name" value={form.name} onChange={(v) => onUpdateField('name', v)}
            placeholder="Character name" maxLength={100} isArmorySynced={isArmorySynced} required error={nameError} />
    );
}

export function CharacterFormFields({
    form, showMmoFields, isArmorySynced, isEditing, editingIsMain, hasMainForGame, nameError, identity, identityValue, identityErrors, onUpdateField,
}: CharacterFormFieldsProps) {
    return (
        <>
            {isArmorySynced && <ArmorySyncBanner />}
            <IdentityFields form={form} identity={identity} identityValue={identityValue} isEditing={isEditing} isArmorySynced={isArmorySynced}
                nameError={nameError} identityErrors={identityErrors} onUpdateField={onUpdateField} />
            {showMmoFields && (
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <SyncableInput label="Class" value={form.class} onChange={(v) => onUpdateField('class', v)}
                            placeholder="e.g. Warrior" maxLength={50} isArmorySynced={isArmorySynced} />
                        <SyncableInput label="Spec" value={form.spec} onChange={(v) => onUpdateField('spec', v)}
                            placeholder="e.g. Arms" maxLength={50} isArmorySynced={isArmorySynced} />
                    </div>
                    <RoleSelect value={form.role} onChange={(v) => onUpdateField('role', v)} />
                    {!identity?.hidesRealm && <SyncableInput label="Realm/Server" value={form.realm} onChange={(v) => onUpdateField('realm', v)}
                        placeholder="e.g. Illidan" maxLength={100} isArmorySynced={isArmorySynced} />}
                </>
            )}
            <MainCheckbox form={form} isEditing={isEditing} editingIsMain={editingIsMain}
                hasMainForGame={hasMainForGame} onUpdateField={onUpdateField} />
        </>
    );
}
