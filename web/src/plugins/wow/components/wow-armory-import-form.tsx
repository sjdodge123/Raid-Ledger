/**
 * Form for importing a WoW character from Blizzard Armory (ROK-234).
 * Flow: select realm -> enter name -> search -> preview card -> confirm import.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { WowRegion, BlizzardCharacterPreviewDto } from '@raid-ledger/contract';
import { useImportWowCharacter } from '../hooks/use-wow-mutations';
import { previewWowCharacter } from '../api-client';
import { RealmAutocomplete } from './realm-autocomplete';
import { CharacterPreviewCard } from './character-preview-card';

interface WowArmoryImportFormProps {
    onSuccess?: (character?: import('@raid-ledger/contract').CharacterDto) => void;
    isMain?: boolean;
    /** Game variant for Blizzard API namespace (retail, classic_era, classic) */
    gameVariant?: string;
    /** Pre-fill the realm field (e.g., from inviter's character) */
    defaultRealm?: string;
    /** ROK-587: Pre-fill the region (e.g., from event context) */
    defaultRegion?: import('@raid-ledger/contract').WowRegion;
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

/** Armory import form main component */
export function WowArmoryImportForm({
    onSuccess, isMain = false, gameVariant,
    defaultRealm, defaultRegion, onRegisterValidator,
}: WowArmoryImportFormProps) {
    const importMutation = useImportWowCharacter();
    const [name, setName] = useState('');
    const [realm, setRealm] = useState(defaultRealm ?? '');
    const [region, setRegion] = useState<WowRegion>(defaultRegion ?? 'us');
    const [setAsMain, setSetAsMain] = useState(isMain);
    const [error, setError] = useState('');
    const [formState, setFormState] = useState<FormState>('idle');
    const [previewData, setPreviewData] = useState<BlizzardCharacterPreviewDto | null>(null);
    const [showSkipWarning, setShowSkipWarning] = useState(false);

    const formStateRef = useRef(formState);
    useEffect(() => { formStateRef.current = formState; }, [formState]);

    const warningShownRef = useRef(false);

    useEffect(() => { setSetAsMain(isMain); }, [isMain]);

    const validator = useCallback(() => {
        if (formStateRef.current === 'preview') {
            if (warningShownRef.current) {
                warningShownRef.current = false;
                setShowSkipWarning(false);
                return true;
            }
            warningShownRef.current = true;
            setShowSkipWarning(true);
            return false;
        }
        warningShownRef.current = false;
        setShowSkipWarning(false);
        return true;
    }, []);

    useEffect(() => { onRegisterValidator?.(validator); }, [onRegisterValidator, validator]);

    const handleSearch = async () => {
        setError('');
        if (!name.trim()) { setError('Character name is required'); return; }
        if (!realm.trim()) { setError('Realm is required'); return; }
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
                onSuccess: (data) => {
                    setFormState('done');
                    setName('');
                    setRealm('');
                    setPreviewData(null);
                    onSuccess?.(data);
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
            {formState !== 'preview' && formState !== 'importing' && formState !== 'done' && (
                <SearchFields
                    region={region} realm={realm} name={name} formState={formState} error={error}
                    gameVariant={gameVariant}
                    onRegionChange={(v) => { setRegion(v); handleFieldChange(); }}
                    onRealmChange={(v) => { setRealm(v); handleFieldChange(); }}
                    onNameChange={(v) => { setName(v); handleFieldChange(); }}
                    onSearch={() => void handleSearch()}
                />
            )}
            {(formState === 'preview' || formState === 'importing') && previewData && (
                <>
                    {showSkipWarning && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-center">
                            <p className="text-xs text-amber-400">
                                You have unsaved progress. Use the buttons on the card, or click <strong>Next</strong> again to skip.
                            </p>
                        </div>
                    )}
                    <CharacterPreviewCard
                        preview={previewData} setAsMain={setAsMain}
                        onSetAsMainChange={setSetAsMain} onImport={handleImport}
                        onBack={handleBack} isImporting={formState === 'importing'}
                        error={error} highlightActions={showSkipWarning}
                    />
                </>
            )}
        </div>
    );
}

/** Search form fields: region, realm, character name */
function SearchFields({ region, realm, name, formState, error, gameVariant,
    onRegionChange, onRealmChange, onNameChange, onSearch,
}: {
    region: WowRegion; realm: string; name: string; formState: FormState;
    error: string; gameVariant?: string;
    onRegionChange: (v: WowRegion) => void;
    onRealmChange: (v: string) => void;
    onNameChange: (v: string) => void;
    onSearch: () => void;
}) {
    return (
        <>
            <div className="space-y-3">
                <div>
                    <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">Region</label>
                    <div className="flex gap-1.5">
                        {REGIONS.map((r) => (
                            <button key={r.value} type="button" onClick={() => onRegionChange(r.value)}
                                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${region === r.value
                                    ? 'bg-blue-600/20 border border-blue-500 text-blue-300'
                                    : 'bg-panel border border-edge text-muted hover:text-foreground hover:border-edge-strong'
                                }`}>
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">
                        Realm <span className="text-red-400 normal-case">*</span>
                    </label>
                    <RealmAutocomplete region={region} value={realm} onChange={onRealmChange} gameVariant={gameVariant} />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                    Character Name <span className="text-red-400">*</span>
                </label>
                <input type="text" value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="e.g. Arthas" maxLength={100}
                    className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(); } }}
                />
            </div>
            {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <span className="text-red-400 text-lg leading-none mt-0.5">&#10060;</span>
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}
            <button type="button" onClick={onSearch} disabled={formState === 'searching'}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                {formState === 'searching' ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-dim border-t-blue-400 rounded-full animate-spin" />
                        Searching Armory...
                    </span>
                ) : 'Search Armory'}
            </button>
        </>
    );
}
