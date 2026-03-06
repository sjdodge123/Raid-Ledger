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

export function CharacterFormFields({
    form, showMmoFields, isArmorySynced, isEditing, editingIsMain, hasMainForGame, onUpdateField,
}: CharacterFormFieldsProps) {
    return (
        <>
            {isArmorySynced && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-sm">
                    <InformationCircleIcon className="w-4 h-4 flex-shrink-0" />
                    <span>This character is synced from the Blizzard Armory. Some fields are read-only.</span>
                </div>
            )}

            <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                    Name <span className="text-red-400">*</span>
                    {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                </label>
                <input type="text" value={form.name}
                    onChange={(e) => onUpdateField('name', e.target.value)}
                    placeholder="Character name" maxLength={100} disabled={isArmorySynced}
                    title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                    className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
            </div>

            {showMmoFields && (
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-secondary mb-1">
                                Class
                                {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                            </label>
                            <input type="text" value={form.class}
                                onChange={(e) => onUpdateField('class', e.target.value)}
                                placeholder="e.g. Warrior" maxLength={50} disabled={isArmorySynced}
                                title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-secondary mb-1">
                                Spec
                                {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                            </label>
                            <input type="text" value={form.spec}
                                onChange={(e) => onUpdateField('spec', e.target.value)}
                                placeholder="e.g. Arms" maxLength={50} disabled={isArmorySynced}
                                title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                                className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">Role</label>
                        <select value={form.role}
                            onChange={(e) => onUpdateField('role', e.target.value as CharacterRole | '')}
                            className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="">Select role...</option>
                            <option value="tank">Tank</option>
                            <option value="healer">Healer</option>
                            <option value="dps">DPS</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">
                            Realm/Server
                            {isArmorySynced && <LockClosedIcon className="w-3.5 h-3.5 inline ml-1 text-muted" />}
                        </label>
                        <input type="text" value={form.realm}
                            onChange={(e) => onUpdateField('realm', e.target.value)}
                            placeholder="e.g. Illidan" maxLength={100} disabled={isArmorySynced}
                            title={isArmorySynced ? 'This field is synced from the Blizzard Armory' : undefined}
                            className={`w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isArmorySynced ? 'opacity-60 cursor-not-allowed' : ''}`}
                        />
                    </div>
                </>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isMain}
                    onChange={(e) => onUpdateField('isMain', e.target.checked)}
                    disabled={(isEditing && editingIsMain) || (!isEditing && !hasMainForGame)}
                    className="w-4 h-4 rounded border-edge-strong bg-panel text-emerald-500 focus:ring-emerald-500 disabled:opacity-50"
                />
                <span className={`text-sm ${(isEditing && editingIsMain) || (!isEditing && !hasMainForGame) ? 'text-muted' : 'text-secondary'}`}>
                    Main character
                    {isEditing && editingIsMain && <span className="ml-1 text-xs text-muted">(already main)</span>}
                    {!isEditing && !hasMainForGame && <span className="ml-1 text-xs text-muted">(no main set)</span>}
                </span>
            </label>
        </>
    );
}
