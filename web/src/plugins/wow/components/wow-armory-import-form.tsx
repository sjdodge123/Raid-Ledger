import { useState } from 'react';
import type { WowRegion, BlizzardCharacterPreviewDto } from '@raid-ledger/contract';
import { useImportWowCharacter } from '../hooks/use-wow-mutations';
import { previewWowCharacter } from '../api-client';
import { RealmAutocomplete } from './realm-autocomplete';

interface WowArmoryImportFormProps {
    onSuccess?: () => void;
    isMain?: boolean;
    /** Game variant for Blizzard API namespace (retail, classic_era, classic) */
    gameVariant?: string;
}

const REGIONS: { value: WowRegion; label: string }[] = [
    { value: 'us', label: 'US' },
    { value: 'eu', label: 'EU' },
    { value: 'kr', label: 'KR' },
    { value: 'tw', label: 'TW' },
];

type FormState = 'idle' | 'searching' | 'preview' | 'importing' | 'done';

/**
 * Form for importing a WoW character from Blizzard Armory (ROK-234).
 * Flow: select realm → enter name → search → preview card → confirm import.
 */
export function WowArmoryImportForm({ onSuccess, isMain = false, gameVariant }: WowArmoryImportFormProps) {
    const importMutation = useImportWowCharacter();
    const [name, setName] = useState('');
    const [realm, setRealm] = useState('');
    const [region, setRegion] = useState<WowRegion>('us');
    const [setAsMain, setSetAsMain] = useState(isMain);
    const [error, setError] = useState('');
    const [formState, setFormState] = useState<FormState>('idle');
    const [previewData, setPreviewData] = useState<BlizzardCharacterPreviewDto | null>(null);

    const handleSearch = async () => {
        setError('');
        if (!name.trim()) {
            setError('Character name is required');
            return;
        }
        if (!realm.trim()) {
            setError('Realm is required');
            return;
        }
        setPreviewData(null);
        setFormState('searching');
        try {
            const data = await previewWowCharacter(name.trim(), realm.trim(), region, gameVariant);
            setPreviewData(data);
            setFormState('preview');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Character not found');
            setFormState('idle');
        }
    };

    const handleImport = () => {
        setError('');
        setFormState('importing');
        importMutation.mutate(
            {
                name: previewData?.name ?? name.trim(),
                realm: previewData?.realm ?? realm.trim(),
                region,
                gameVariant: gameVariant as 'retail' | 'classic_era' | 'classic' | undefined,
                isMain: setAsMain,
            },
            {
                onSuccess: () => {
                    setFormState('done');
                    setName('');
                    setRealm('');
                    setPreviewData(null);
                    onSuccess?.();
                },
                onError: (err) => {
                    setError(err.message);
                    setFormState('preview');
                },
            },
        );
    };

    const handleBack = () => {
        setPreviewData(null);
        setFormState('idle');
        setError('');
    };

    const handleFieldChange = () => {
        if (formState === 'preview' || formState === 'done') {
            setPreviewData(null);
            setFormState('idle');
        }
    };

    return (
        <div className="space-y-4">
            {/* Search fields */}
            {formState !== 'preview' && formState !== 'importing' && (
                <>
                    {/* Realm + Region (first, so realm autocomplete loads while user types name) */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-secondary mb-1">
                                Realm <span className="text-red-400">*</span>
                            </label>
                            <RealmAutocomplete
                                region={region}
                                value={realm}
                                onChange={(v) => { setRealm(v); handleFieldChange(); }}
                                gameVariant={gameVariant}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-secondary mb-1">
                                Region
                            </label>
                            <select
                                value={region}
                                onChange={(e) => { setRegion(e.target.value as WowRegion); handleFieldChange(); }}
                                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {REGIONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Character Name */}
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">
                            Character Name <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => { setName(e.target.value); handleFieldChange(); }}
                            placeholder="e.g. Arthas"
                            maxLength={100}
                            className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
                        />
                    </div>

                    {/* Set as Main */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={setAsMain}
                            onChange={(e) => setSetAsMain(e.target.checked)}
                            className="w-4 h-4 rounded border-edge-strong bg-panel text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-sm text-secondary">Set as main character</span>
                    </label>

                    {/* Error — prominent "not found" style for search failures */}
                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <span className="text-red-400 text-lg leading-none mt-0.5">&#10060;</span>
                            <div className="text-sm">
                                <p className="font-medium text-red-400">Character not found</p>
                                <p className="text-red-400/80 mt-0.5">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* Search button */}
                    <button
                        type="button"
                        onClick={() => void handleSearch()}
                        disabled={formState === 'searching'}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors"
                    >
                        {formState === 'searching' ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="w-4 h-4 border-2 border-dim border-t-blue-400 rounded-full animate-spin" />
                                Searching Armory...
                            </span>
                        ) : (
                            'Search Armory'
                        )}
                    </button>
                </>
            )}

            {/* Preview card */}
            {(formState === 'preview' || formState === 'importing') && previewData && (
                <CharacterPreviewCard
                    preview={previewData}
                    setAsMain={setAsMain}
                    onSetAsMainChange={setSetAsMain}
                    onImport={handleImport}
                    onBack={handleBack}
                    isImporting={formState === 'importing'}
                    error={error}
                />
            )}
        </div>
    );
}

// ============================================================
// Character Preview Card
// ============================================================

interface CharacterPreviewCardProps {
    preview: BlizzardCharacterPreviewDto;
    setAsMain: boolean;
    onSetAsMainChange: (v: boolean) => void;
    onImport: () => void;
    onBack: () => void;
    isImporting: boolean;
    error: string;
}

function CharacterPreviewCard({
    preview,
    setAsMain,
    onSetAsMainChange,
    onImport,
    onBack,
    isImporting,
    error,
}: CharacterPreviewCardProps) {
    const factionColor = preview.faction === 'alliance'
        ? 'text-blue-400'
        : 'text-red-400';
    const factionBg = preview.faction === 'alliance'
        ? 'bg-blue-900/30 border-blue-700/40'
        : 'bg-red-900/30 border-red-700/40';

    const roleEmoji = preview.role === 'tank' ? '🛡️' : preview.role === 'healer' ? '💚' : '⚔️';

    return (
        <div className="space-y-3">
            <div className={`rounded-lg border p-3 ${factionBg}`}>
                <div className="flex gap-3">
                    {/* Avatar */}
                    {preview.avatarUrl ? (
                        <img
                            src={preview.avatarUrl}
                            alt={preview.name}
                            className="w-16 h-16 rounded-lg object-cover border border-edge/50"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="w-16 h-16 rounded-lg bg-overlay flex items-center justify-center text-2xl border border-edge/50">
                            ⚔️
                        </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="text-foreground font-bold text-lg truncate">{preview.name}</h3>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${factionColor} ${factionBg}`}>
                                {preview.faction.charAt(0).toUpperCase() + preview.faction.slice(1)}
                            </span>
                        </div>
                        <p className="text-secondary text-sm">{preview.realm}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm">
                            <span className="text-muted">{preview.race}</span>
                            <span className="text-foreground font-medium">{preview.class}</span>
                            {preview.spec && (
                                <span className="text-secondary">
                                    {preview.spec}
                                    {preview.role && <span className="ml-1">{roleEmoji}</span>}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-edge/30">
                    <div className="text-sm">
                        <span className="text-muted">Level </span>
                        <span className="text-foreground font-medium">{preview.level}</span>
                    </div>
                    {preview.itemLevel && (
                        <div className="text-sm">
                            <span className="text-muted">iLvl </span>
                            <span className="text-amber-400 font-medium">{preview.itemLevel}</span>
                        </div>
                    )}
                    {preview.profileUrl && (
                        <a
                            href={preview.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            View on Armory &rarr;
                        </a>
                    )}
                </div>
            </div>

            {/* Set as Main */}
            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={setAsMain}
                    onChange={(e) => onSetAsMainChange(e.target.checked)}
                    className="w-4 h-4 rounded border-edge-strong bg-panel text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-secondary">Set as main character</span>
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onBack}
                    disabled={isImporting}
                    className="px-4 py-2 bg-panel hover:bg-overlay text-foreground rounded-lg transition-colors text-sm"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={onImport}
                    disabled={isImporting}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors"
                >
                    {isImporting ? (
                        <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-dim border-t-blue-400 rounded-full animate-spin" />
                            Importing...
                        </span>
                    ) : (
                        'Import this character'
                    )}
                </button>
            </div>
        </div>
    );
}
