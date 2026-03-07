import { useCallback, useState } from 'react';
import type { CharacterRole, CharacterDto } from '@raid-ledger/contract';
import { useCreateCharacter } from '../../hooks/use-character-mutations';
import { PluginSlot } from '../../plugins';

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
 * where a full modal isn't appropriate.
 */
const INLINE_INPUT_CLS = 'px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm';

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

function InlineRoleFields({ charClass, spec, role, realm, onClassChange, onSpecChange, onRoleChange, onRealmChange }: {
    charClass: string; spec: string; role: CharacterRole | ''; realm: string;
    onClassChange: (v: string) => void; onSpecChange: (v: string) => void;
    onRoleChange: (v: CharacterRole | '') => void; onRealmChange: (v: string) => void;
}) {
    return (
        <>
            <div className="grid grid-cols-2 gap-2">
                <input type="text" value={charClass} onChange={(e) => onClassChange(e.target.value)} placeholder="Class" maxLength={50} className={INLINE_INPUT_CLS} />
                <input type="text" value={spec} onChange={(e) => onSpecChange(e.target.value)} placeholder="Spec" maxLength={50} className={INLINE_INPUT_CLS} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <select value={role} onChange={(e) => onRoleChange(e.target.value as CharacterRole | '')} className={INLINE_INPUT_CLS}>
                    <option value="">Role...</option><option value="tank">Tank</option><option value="healer">Healer</option><option value="dps">DPS</option>
                </select>
                <input type="text" value={realm} onChange={(e) => onRealmChange(e.target.value)} placeholder="Realm" maxLength={100} className={INLINE_INPUT_CLS} />
            </div>
        </>
    );
}

function InlineFormFooter({ onCancel, isPending }: { onCancel?: () => void; isPending: boolean }) {
    return (
        <div className="flex gap-2">
            {onCancel && <button type="button" onClick={onCancel} className="flex-1 px-3 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors text-sm">Cancel</button>}
            <button type="submit" disabled={isPending} className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-foreground font-medium rounded-lg transition-colors text-sm">
                {isPending ? 'Creating...' : 'Create Character'}
            </button>
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
    const [error, setError] = useState('');
    const [pluginImportActive, setPluginImportActive] = useState(false);
    const handleModeChange = useCallback((mode: 'import' | 'manual') => { setPluginImportActive(mode === 'import'); }, []);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault(); setError('');
        if (!name.trim()) { setError('Character name is required'); return; }
        createMutation.mutate(
            buildInlinePayload(name, charClass, spec, role, realm, gameId, hasRoles),
            { onSuccess: (data) => onCharacterCreated?.(data), onError: (err) => setError(err.message) },
        );
    };

    return (
        <div className="space-y-3">
            <PluginSlot name="character-create:inline-import" context={{ onSuccess: onCharacterCreated, isMain: true, gameSlug, onModeChange: handleModeChange, eventId }} />
            {!pluginImportActive && <form onSubmit={handleManualSubmit} className="space-y-3">
                <div><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" maxLength={100} className={`w-full ${INLINE_INPUT_CLS}`} /></div>
                {hasRoles && <InlineRoleFields charClass={charClass} spec={spec} role={role} realm={realm} onClassChange={setCharClass} onSpecChange={setSpec} onRoleChange={setRole} onRealmChange={setRealm} />}
                {error && <p className="text-xs text-red-400">{error}</p>}
                <InlineFormFooter onCancel={onCancel} isPending={createMutation.isPending} />
            </form>}
        </div>
    );
}
