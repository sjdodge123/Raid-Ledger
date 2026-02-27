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
    onCharacterCreated?: (character: CharacterDto) => void;
    onCancel?: () => void;
}

/**
 * Reusable inline character creation form (ROK-234).
 * Used inside the signup confirmation modal and other contexts
 * where a full modal isn't appropriate.
 */
export function InlineCharacterForm({
    gameId,
    hasRoles = true,
    gameSlug,
    onCharacterCreated,
    onCancel,
}: InlineCharacterFormProps) {
    const createMutation = useCreateCharacter();
    const [name, setName] = useState('');
    const [charClass, setCharClass] = useState('');
    const [spec, setSpec] = useState('');
    const [role, setRole] = useState<CharacterRole | ''>('');
    const [realm, setRealm] = useState('');
    const [error, setError] = useState('');
    // Track plugin import mode — hide the manual form when plugin is in import mode
    const [pluginImportActive, setPluginImportActive] = useState(true);
    const handleModeChange = useCallback((mode: 'import' | 'manual') => {
        setPluginImportActive(mode === 'import');
    }, []);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!name.trim()) {
            setError('Character name is required');
            return;
        }

        createMutation.mutate(
            {
                gameId,
                name: name.trim(),
                class: hasRoles ? (charClass.trim() || undefined) : undefined,
                spec: hasRoles ? (spec.trim() || undefined) : undefined,
                role: hasRoles ? (role || undefined) : undefined,
                realm: hasRoles ? (realm.trim() || undefined) : undefined,
                isMain: true, // First character for this game is main by default
            },
            {
                onSuccess: (data) => {
                    onCharacterCreated?.(data);
                },
                onError: (err) => {
                    setError(err.message);
                },
            },
        );
    };

    return (
        <div className="space-y-3">
            {/* Plugin slot for WoW import mode toggle + form */}
            <PluginSlot
                name="character-create:inline-import"
                context={{
                    onSuccess: onCharacterCreated,
                    isMain: true,
                    gameSlug,
                    onModeChange: handleModeChange,
                }}
            />

            {!pluginImportActive && <form onSubmit={handleManualSubmit} className="space-y-3">
                <div>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Character name"
                        maxLength={100}
                        className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                </div>

                {hasRoles && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={charClass}
                                onChange={(e) => setCharClass(e.target.value)}
                                placeholder="Class"
                                maxLength={50}
                                className="px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                            />
                            <input
                                type="text"
                                value={spec}
                                onChange={(e) => setSpec(e.target.value)}
                                placeholder="Spec"
                                maxLength={50}
                                className="px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={role}
                                onChange={(e) => setRole(e.target.value as CharacterRole | '')}
                                className="px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                            >
                                <option value="">Role...</option>
                                <option value="tank">Tank</option>
                                <option value="healer">Healer</option>
                                <option value="dps">DPS</option>
                            </select>
                            <input
                                type="text"
                                value={realm}
                                onChange={(e) => setRealm(e.target.value)}
                                placeholder="Realm"
                                maxLength={100}
                                className="px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                            />
                        </div>
                    </>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}

                <div className="flex gap-2">
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 px-3 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors text-sm"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={createMutation.isPending}
                        className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-dim text-foreground font-medium rounded-lg transition-colors text-sm"
                    >
                        {createMutation.isPending ? 'Creating...' : 'Create Character'}
                    </button>
                </div>
            </form>}
        </div>
    );
}
