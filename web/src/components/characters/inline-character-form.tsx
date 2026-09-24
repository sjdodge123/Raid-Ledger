import { useCallback, useState } from 'react';
import type { CharacterRole, CharacterDto } from '@raid-ledger/contract';
import { useCreateCharacter } from '../../hooks/use-character-mutations';
import { PluginSlot } from '../../plugins';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

interface InlineCharacterFormProps {
    gameId: number;
    hasRoles?: boolean;
    hasSpecs?: boolean;
    /** Game slug for plugin slot context (enables WoW import when plugin active) */
    gameSlug?: string;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
    onCharacterCreated?: (character: CharacterDto) => void;
    onCancel?: () => void;
}

/**
 * Reusable inline character creation form (ROK-234).
 * Used inside the signup confirmation modal and other contexts
 * where a full modal isn't appropriate. ROK-1648: shared Field / Input /
 * Select / Button primitives; a missing name is a Field error on the name
 * input, a failed create is a separate form-level alert.
 */
function buildInlinePayload(name: string, charClass: string, spec: string, role: CharacterRole | '', realm: string, gameId: number, hasRoles: boolean) {
    return {
        gameId, name: name.trim(),
        class: hasRoles ? (charClass.trim() || undefined) : undefined,
        spec: hasRoles ? (spec.trim() || undefined) : undefined,
        role: hasRoles ? (role || undefined) : undefined,
        realm: hasRoles ? (realm.trim() || undefined) : undefined,
        isMain: true,
    };
}

function InlineTextField({ label, value, onChange, maxLength, error }: {
    label: string; value: string; onChange: (v: string) => void; maxLength: number; error?: string;
}) {
    return (
        <Field label={label} hideLabel error={error || undefined}>
            <Input type="text" fieldSize="sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} maxLength={maxLength} />
        </Field>
    );
}

function InlineRoleFields({ charClass, spec, role, realm, onClassChange, onSpecChange, onRoleChange, onRealmChange }: {
    charClass: string; spec: string; role: CharacterRole | ''; realm: string;
    onClassChange: (v: string) => void; onSpecChange: (v: string) => void;
    onRoleChange: (v: CharacterRole | '') => void; onRealmChange: (v: string) => void;
}) {
    return (
        <>
            <div className="grid grid-cols-2 gap-2">
                <InlineTextField label="Class" value={charClass} onChange={onClassChange} maxLength={50} />
                <InlineTextField label="Spec" value={spec} onChange={onSpecChange} maxLength={50} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Role" hideLabel>
                    <Select fieldSize="sm" value={role} onChange={(e) => onRoleChange(e.target.value as CharacterRole | '')} placeholder="Role...">
                        <option value="tank">Tank</option><option value="healer">Healer</option><option value="dps">DPS</option>
                    </Select>
                </Field>
                <InlineTextField label="Realm" value={realm} onChange={onRealmChange} maxLength={100} />
            </div>
        </>
    );
}

function InlineFormFooter({ onCancel, isPending }: { onCancel?: () => void; isPending: boolean }) {
    return (
        <div className="flex gap-2">
            {onCancel && <Button variant="secondary" size="sm" className="flex-1" onClick={onCancel}>Cancel</Button>}
            <Button type="submit" variant="primary" size="sm" className="flex-1" loading={isPending} loadingLabel="Creating…">
                Create Character
            </Button>
        </div>
    );
}

export function InlineCharacterForm({ gameId, hasRoles = true, gameSlug, eventId, onCharacterCreated, onCancel }: InlineCharacterFormProps) {
    const createMutation = useCreateCharacter();
    const [name, setName] = useState('');
    const [charClass, setCharClass] = useState('');
    const [spec, setSpec] = useState('');
    const [role, setRole] = useState<CharacterRole | ''>('');
    const [realm, setRealm] = useState('');
    const [errors, setErrors] = useState<{ name?: string; form?: string }>({});
    const [pluginImportActive, setPluginImportActive] = useState(false);
    const handleModeChange = useCallback((mode: 'import' | 'manual') => { setPluginImportActive(mode === 'import'); }, []);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault(); setErrors({});
        if (!name.trim()) { setErrors({ name: 'Character name is required' }); return; }
        createMutation.mutate(
            buildInlinePayload(name, charClass, spec, role, realm, gameId, hasRoles),
            { onSuccess: (data) => onCharacterCreated?.(data), onError: (err) => setErrors({ form: err.message }) },
        );
    };

    return (
        <div className="space-y-3">
            <PluginSlot name="character-create:inline-import" context={{ onSuccess: onCharacterCreated, isMain: true, gameSlug, onModeChange: handleModeChange, eventId }} />
            {!pluginImportActive && <form onSubmit={handleManualSubmit} className="space-y-3">
                <InlineTextField label="Character name" value={name} onChange={setName} maxLength={100} error={errors.name} />
                {hasRoles && <InlineRoleFields charClass={charClass} spec={spec} role={role} realm={realm} onClassChange={setCharClass} onSpecChange={setSpec} onRoleChange={setRole} onRealmChange={setRealm} />}
                {errors.form && <p role="alert" className="text-xs text-danger">{errors.form}</p>}
                <InlineFormFooter onCancel={onCancel} isPending={createMutation.isPending} />
            </form>}
        </div>
    );
}
