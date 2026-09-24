/**
 * Form for importing a WoW character from Blizzard Armory (ROK-234).
 * Flow: select realm -> enter name -> search -> preview card -> confirm import.
 */
import type { WowGameVariant } from '@raid-ledger/contract';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { WowRegion, BlizzardCharacterPreviewDto } from '@raid-ledger/contract';
import { useImportWowCharacter } from '../hooks/use-wow-mutations';
import { previewWowCharacter } from '../api-client';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { RadioGroup } from '../../../components/ui/radio-group';
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

/** Ruling 8: these two render as their Field's error; every other message (the API's) is the banner's. */
const NAME_REQUIRED = 'Character name is required';
const REALM_REQUIRED = 'Realm is required';

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
    const [prevIsMain, setPrevIsMain] = useState(isMain);
    const [error, setError] = useState('');
    const [formState, setFormState] = useState<FormState>('idle');
    const [previewData, setPreviewData] = useState<BlizzardCharacterPreviewDto | null>(null);
    const formStateRef = useRef(formState);
    useEffect(() => { formStateRef.current = formState; }, [formState]);
    if (isMain !== prevIsMain) {
        setPrevIsMain(isMain);
        setSetAsMain(isMain);
    }
    return { name, setName, realm, setRealm, region, setRegion, setAsMain, setSetAsMain, error, setError, formState, setFormState, previewData, setPreviewData, formStateRef };
}

function useSearchHandler(state: ReturnType<typeof useImportFormState>, gameVariant: string | undefined) {
    return useCallback(async () => {
        state.setError('');
        if (!state.name.trim()) { state.setError(NAME_REQUIRED); return; }
        if (!state.realm.trim()) { state.setError(REALM_REQUIRED); return; }
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
            region: state.region, gameVariant: gameVariant as WowGameVariant | undefined, isMain: state.setAsMain,
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
                    {showSkipWarning && <div className="bg-warning/10 border border-warning/30 rounded-lg p-2.5 text-center"><p className="text-xs text-warning">You have unsaved progress. Use the buttons on the card, or click <strong>Next</strong> again to skip.</p></div>}
                    <CharacterPreviewCard preview={state.previewData!} setAsMain={state.setAsMain} onSetAsMainChange={state.setSetAsMain} onImport={handlers.handleImport}
                        onBack={handlers.handleBack} isImporting={state.formState === 'importing'} error={state.error} highlightActions={showSkipWarning} />
                </>
            )}
        </div>
    );
}

function RegionSelector({ region, onRegionChange }: { region: WowRegion; onRegionChange: (v: WowRegion) => void }) {
    return <RadioGroup appearance="segmented" label="Region" options={REGIONS} value={region} onChange={onRegionChange} />;
}

function CharacterNameInput({ name, error, onNameChange, onSearch }: {
    name: string; error?: string; onNameChange: (v: string) => void; onSearch: () => void;
}) {
    return (
        <Field label="Character Name" required error={error}>
            <Input type="text" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Arthas" maxLength={100}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(); } }} />
        </Field>
    );
}

function SearchErrorBanner({ error }: { error: string }) {
    return (
        <div role="alert" className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg">
            <span aria-hidden="true" className="text-lg leading-none mt-0.5">&#10060;</span>
            <p className="text-sm text-danger">{error}</p>
        </div>
    );
}

/** Ruling 8: a missing name or realm is that Field's error (aria-invalid); anything else stays in the banner. */
function splitSearchError(error: string) {
    const nameErr = error === NAME_REQUIRED ? error : undefined;
    const realmErr = error === REALM_REQUIRED ? error : undefined;
    return { nameErr, realmErr, bannerErr: nameErr || realmErr ? '' : error };
}

/** Search form fields: region, realm, character name */
function SearchFields({ region, realm, name, formState, error, gameVariant, onRegionChange, onRealmChange, onNameChange, onSearch }: {
    region: WowRegion; realm: string; name: string; formState: FormState; error: string; gameVariant?: string;
    onRegionChange: (v: WowRegion) => void; onRealmChange: (v: string) => void; onNameChange: (v: string) => void; onSearch: () => void;
}) {
    const { nameErr, realmErr, bannerErr } = splitSearchError(error);
    return (
        <>
            <div className="space-y-3">
                <RegionSelector region={region} onRegionChange={onRegionChange} />
                <Field label="Realm" required error={realmErr}>
                    <RealmAutocomplete region={region} value={realm} onChange={onRealmChange} gameVariant={gameVariant} />
                </Field>
            </div>
            <CharacterNameInput name={name} error={nameErr} onNameChange={onNameChange} onSearch={onSearch} />
            {bannerErr && <SearchErrorBanner error={bannerErr} />}
            <Button fullWidth loading={formState === 'searching'} loadingLabel="Searching Armory…" onClick={onSearch}>Search Armory</Button>
        </>
    );
}
