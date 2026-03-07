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

function useSkipWarningValidator(formStateRef: React.RefObject<FormState>, onRegisterValidator: WowArmoryImportFormProps['onRegisterValidator']) {
    const warningShownRef = useRef(false);
    const [showSkipWarning, setShowSkipWarning] = useState(false);

    const validator = useCallback(() => {
        if (formStateRef.current === 'preview') {
            if (warningShownRef.current) { warningShownRef.current = false; setShowSkipWarning(false); return true; }
            warningShownRef.current = true; setShowSkipWarning(true); return false;
        }
        warningShownRef.current = false; setShowSkipWarning(false); return true;
    }, [formStateRef]);

    useEffect(() => { onRegisterValidator?.(validator); }, [onRegisterValidator, validator]);

    return { showSkipWarning, setShowSkipWarning, warningShownRef };
}

function useImportFormState(isMain: boolean, defaultRealm?: string, defaultRegion?: WowRegion) {
    const [name, setName] = useState('');
    const [realm, setRealm] = useState(defaultRealm ?? '');
    const [region, setRegion] = useState<WowRegion>(defaultRegion ?? 'us');
    const [setAsMain, setSetAsMain] = useState(isMain);
    const [error, setError] = useState('');
    const [formState, setFormState] = useState<FormState>('idle');
    const [previewData, setPreviewData] = useState<BlizzardCharacterPreviewDto | null>(null);
    const formStateRef = useRef(formState);
    useEffect(() => { formStateRef.current = formState; }, [formState]);
    useEffect(() => { setSetAsMain(isMain); }, [isMain]);
    return { name, setName, realm, setRealm, region, setRegion, setAsMain, setSetAsMain, error, setError, formState, setFormState, previewData, setPreviewData, formStateRef };
}

function useSearchHandler(state: ReturnType<typeof useImportFormState>, gameVariant: string | undefined) {
    return useCallback(async () => {
        state.setError('');
        if (!state.name.trim()) { state.setError('Character name is required'); return; }
        if (!state.realm.trim()) { state.setError('Realm is required'); return; }
        state.setPreviewData(null); state.setFormState('searching');
        try {
            const data = await previewWowCharacter(state.name.trim(), state.realm.trim(), state.region, gameVariant);
            state.setPreviewData(data); state.setFormState('preview');
        } catch (err) { state.setError(err instanceof Error ? err.message : 'Character not found'); state.setFormState('idle'); }
    }, [state, gameVariant]);
}

function useImportHandler(state: ReturnType<typeof useImportFormState>, gameVariant: string | undefined, onSuccess: WowArmoryImportFormProps['onSuccess']) {
    const importMutation = useImportWowCharacter();
    return useCallback(() => {
        state.setError(''); state.setFormState('importing');
        importMutation.mutate({
            name: state.previewData?.name ?? state.name.trim(), realm: state.previewData?.realm ?? state.realm.trim(),
            region: state.region, gameVariant: gameVariant as 'retail' | 'classic_era' | 'classic' | undefined, isMain: state.setAsMain,
        }, {
            onSuccess: (data) => { state.setFormState('done'); state.setName(''); state.setRealm(''); state.setPreviewData(null); onSuccess?.(data); },
            onError: (err) => { state.setError(err.message); state.setFormState('preview'); },
        });
    }, [state, importMutation, gameVariant, onSuccess]);
}

function useImportFormHandlers(
    state: ReturnType<typeof useImportFormState>,
    gameVariant: string | undefined,
    onSuccess: WowArmoryImportFormProps['onSuccess'],
    warningShownRef: React.RefObject<boolean>,
    setShowSkipWarning: (v: boolean) => void,
) {
    const handleSearch = useSearchHandler(state, gameVariant);
    const handleImport = useImportHandler(state, gameVariant, onSuccess);

    const handleBack = useCallback(() => {
        state.setPreviewData(null); state.setFormState('idle'); state.setError(''); setShowSkipWarning(false); warningShownRef.current = false;
    }, [state, setShowSkipWarning, warningShownRef]);

    const handleFieldChange = useCallback(() => {
        if (state.formState === 'preview' || state.formState === 'done') { state.setPreviewData(null); state.setFormState('idle'); }
    }, [state]);

    return { handleSearch, handleImport, handleBack, handleFieldChange };
}

/** Armory import form main component */
export function WowArmoryImportForm({ onSuccess, isMain = false, gameVariant, defaultRealm, defaultRegion, onRegisterValidator }: WowArmoryImportFormProps) {
    const state = useImportFormState(isMain, defaultRealm, defaultRegion);
    const { showSkipWarning, setShowSkipWarning, warningShownRef } = useSkipWarningValidator(state.formStateRef, onRegisterValidator);
    const handlers = useImportFormHandlers(state, gameVariant, onSuccess, warningShownRef, setShowSkipWarning);
    const showSearch = state.formState !== 'preview' && state.formState !== 'importing' && state.formState !== 'done';
    const showPreview = (state.formState === 'preview' || state.formState === 'importing') && state.previewData;

    return (
        <div className="space-y-4">
            {showSearch && <SearchFields region={state.region} realm={state.realm} name={state.name} formState={state.formState} error={state.error} gameVariant={gameVariant}
                onRegionChange={(v) => { state.setRegion(v); handlers.handleFieldChange(); }} onRealmChange={(v) => { state.setRealm(v); handlers.handleFieldChange(); }}
                onNameChange={(v) => { state.setName(v); handlers.handleFieldChange(); }} onSearch={() => void handlers.handleSearch()} />}
            {showPreview && (
                <>
                    {showSkipWarning && <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-center"><p className="text-xs text-amber-400">You have unsaved progress. Use the buttons on the card, or click <strong>Next</strong> again to skip.</p></div>}
                    <CharacterPreviewCard preview={state.previewData!} setAsMain={state.setAsMain} onSetAsMainChange={state.setSetAsMain} onImport={handlers.handleImport}
                        onBack={handlers.handleBack} isImporting={state.formState === 'importing'} error={state.error} highlightActions={showSkipWarning} />
                </>
            )}
        </div>
    );
}

function RegionSelector({ region, onRegionChange }: { region: WowRegion; onRegionChange: (v: WowRegion) => void }) {
    return (
        <div>
            <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">Region</label>
            <div className="flex gap-1.5">
                {REGIONS.map((r) => (
                    <button key={r.value} type="button" onClick={() => onRegionChange(r.value)}
                        className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${region === r.value ? 'bg-blue-600/20 border border-blue-500 text-blue-300' : 'bg-panel border border-edge text-muted hover:text-foreground hover:border-edge-strong'}`}>
                        {r.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function CharacterNameInput({ name, onNameChange, onSearch }: { name: string; onNameChange: (v: string) => void; onSearch: () => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">Character Name <span className="text-red-400">*</span></label>
            <input type="text" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Arthas" maxLength={100}
                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(); } }} />
        </div>
    );
}

/** Search form fields: region, realm, character name */
function SearchFields({ region, realm, name, formState, error, gameVariant, onRegionChange, onRealmChange, onNameChange, onSearch }: {
    region: WowRegion; realm: string; name: string; formState: FormState; error: string; gameVariant?: string;
    onRegionChange: (v: WowRegion) => void; onRealmChange: (v: string) => void; onNameChange: (v: string) => void; onSearch: () => void;
}) {
    return (
        <>
            <div className="space-y-3">
                <RegionSelector region={region} onRegionChange={onRegionChange} />
                <div>
                    <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-1.5">Realm <span className="text-red-400 normal-case">*</span></label>
                    <RealmAutocomplete region={region} value={realm} onChange={onRealmChange} gameVariant={gameVariant} />
                </div>
            </div>
            <CharacterNameInput name={name} onNameChange={onNameChange} onSearch={onSearch} />
            {error && <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg"><span className="text-red-400 text-lg leading-none mt-0.5">&#10060;</span><p className="text-sm text-red-400">{error}</p></div>}
            <button type="button" onClick={onSearch} disabled={formState === 'searching'}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors">
                {formState === 'searching' ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-dim border-t-blue-400 rounded-full animate-spin" />Searching Armory...</span> : 'Search Armory'}
            </button>
        </>
    );
}
