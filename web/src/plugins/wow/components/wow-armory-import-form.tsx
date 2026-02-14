import { useState, useEffect, useRef, useCallback } from 'react';
import type { WowRegion, BlizzardCharacterPreviewDto } from '@raid-ledger/contract';
import { useImportWowCharacter } from '../hooks/use-wow-mutations';
import { previewWowCharacter } from '../api-client';
import { RealmAutocomplete } from './realm-autocomplete';

interface WowArmoryImportFormProps {
    onSuccess?: () => void;
    isMain?: boolean;
    /** Game variant for Blizzard API namespace (retail, classic_era, classic) */
    gameVariant?: string;
    /** Register a validator fn with the wizard. Return false = block Next. */
    onRegisterValidator?: (fn: () => boolean) => void;
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
export function WowArmoryImportForm({ onSuccess, isMain = false, gameVariant, onRegisterValidator }: WowArmoryImportFormProps) {
    const importMutation = useImportWowCharacter();
    const [name, setName] = useState('');
    const [realm, setRealm] = useState('');
    const [region, setRegion] = useState<WowRegion>('us');
    const [setAsMain, setSetAsMain] = useState(isMain);
    const [error, setError] = useState('');
    const [formState, setFormState] = useState<FormState>('idle');
    const [previewData, setPreviewData] = useState<BlizzardCharacterPreviewDto | null>(null);
    const [showSkipWarning, setShowSkipWarning] = useState(false);

    // Track current formState in a ref so the validator closure always reads latest
    const formStateRef = useRef(formState);
    useEffect(() => {
        formStateRef.current = formState;
    }, [formState]);

    // Track whether the warning was already shown so second Next click passes through
    const warningShownRef = useRef(false);

    // Sync isMain prop into local state when it changes (e.g. after characters query resolves)
    useEffect(() => {
        setSetAsMain(isMain);
    }, [isMain]);

    // Register validator with the wizard — blocks Next when preview is unsaved
    const validator = useCallback(() => {
        if (formStateRef.current === 'preview') {
            if (warningShownRef.current) {
                // Second click — let it through
                warningShownRef.current = false;
                setShowSkipWarning(false);
                return true;
            }
            // First click — show warning, block
            warningShownRef.current = true;
            setShowSkipWarning(true);
            return false;
        }
        warningShownRef.current = false;
        setShowSkipWarning(false);
        return true;
    }, []);

    useEffect(() => {
        onRegisterValidator?.(validator);
    }, [onRegisterValidator, validator]);

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
        const importName = previewData?.name ?? name.trim();
        importMutation.mutate(
            {
                name: importName,
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
        setShowSkipWarning(false);
        warningShownRef.current = false;
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
            {formState !== 'preview' && formState !== 'importing' && formState !== 'done' && (
                <>
                    {/* Filter bar — region + realm selection */}
                    <div className="space-y-3">
                        {/* Region filter pills */}
                        <div>
                            <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">
                                Region
                            </label>
                            <div className="flex gap-1.5">
                                {REGIONS.map((r) => (
                                    <button
                                        key={r.value}
                                        type="button"
                                        onClick={() => { setRegion(r.value); handleFieldChange(); }}
                                        className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${region === r.value
                                            ? 'bg-blue-600/20 border border-blue-500 text-blue-300'
                                            : 'bg-panel border border-edge text-muted hover:text-foreground hover:border-edge-strong'
                                            }`}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Realm search */}
                        <div>
                            <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">
                                Realm <span className="text-red-400 normal-case">*</span>
                            </label>
                            <RealmAutocomplete
                                region={region}
                                value={realm}
                                onChange={(v) => { setRealm(v); handleFieldChange(); }}
                                gameVariant={gameVariant}
                            />
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


                    {/* Error — prominent styled card for search/validation failures */}
                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <span className="text-red-400 text-lg leading-none mt-0.5">&#10060;</span>
                            <p className="text-sm text-red-400">{error}</p>
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
                <>
                    {/* Warning: only shown when user clicked Next with unsaved preview */}
                    {showSkipWarning && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-amber-400">
                                You have unsaved progress. Use the buttons on the card, or click <strong>Next</strong> again to skip.
                            </p>
                        </div>
                    )}
                    <CharacterPreviewCard
                        preview={previewData}
                        setAsMain={setAsMain}
                        onSetAsMainChange={setSetAsMain}
                        onImport={handleImport}
                        onBack={handleBack}
                        isImporting={formState === 'importing'}
                        error={error}
                        highlightActions={showSkipWarning}
                    />
                </>
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
    /** When true, pulse the action buttons to draw attention */
    highlightActions?: boolean;
}

function CharacterPreviewCard({
    preview,
    setAsMain,
    onSetAsMainChange,
    onImport,
    onBack,
    isImporting,
    error,
    highlightActions,
}: CharacterPreviewCardProps) {
    const factionColor = preview.faction === 'alliance'
        ? 'text-blue-400'
        : 'text-red-400';
    const factionBg = preview.faction === 'alliance'
        ? 'bg-blue-900/30 border-blue-700/40'
        : 'bg-red-900/30 border-red-700/40';

    const roleEmoji = preview.role === 'tank' ? '🛡️' : preview.role === 'healer' ? '💚' : '⚔️';

    return (
        <div className="space-y-2">
            <div className={`rounded-lg border overflow-hidden ${factionBg}`}>
                <div className="flex">
                    {/* Left: character info + stats */}
                    <div className="flex-1 min-w-0 flex flex-col">
                        {/* Info section */}
                        <div className="p-3">
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

                                {/* Name + details */}
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
                        </div>

                        {/* Footer stats */}
                        <div className="flex items-center gap-4 px-3 py-2 border-t border-edge/30 mt-auto">
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
                                    Armory &rarr;
                                </a>
                            )}
                        </div>
                    </div>

                    {/* Right: full-height action buttons — Main | X | ✓ */}
                    <div className="flex flex-shrink-0 border-l border-edge/30">
                        {/* Main toggle */}
                        <button
                            type="button"
                            onClick={() => onSetAsMainChange(!setAsMain)}
                            title={setAsMain ? 'Will be set as main character' : 'Click to set as main'}
                            className={`w-16 flex flex-col items-center justify-center gap-0.5 border-r border-edge/20 font-semibold text-xs transition-all ${setAsMain
                                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                                : 'bg-panel/30 text-muted hover:text-secondary hover:bg-panel/50'
                                }`}
                        >
                            <span className="text-lg">{setAsMain ? '⭐' : '☆'}</span>
                            <span>Main</span>
                        </button>

                        {/* Dismiss (red X) */}
                        <button
                            type="button"
                            onClick={onBack}
                            disabled={isImporting}
                            aria-label="Dismiss"
                            title="Dismiss"
                            className={`w-16 flex items-center justify-center bg-red-600/15 border-r border-edge/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${highlightActions ? 'animate-pulse bg-red-600/25 ring-inset ring-2 ring-red-400/60' : ''}`}
                        >
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {/* Save (green check) — solid green */}
                        <button
                            type="button"
                            onClick={onImport}
                            disabled={isImporting}
                            aria-label="Save character"
                            title="Save character"
                            className={`w-16 flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${highlightActions ? 'animate-pulse ring-inset ring-2 ring-emerald-300/60' : ''}`}
                        >
                            {isImporting ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
    );
}
