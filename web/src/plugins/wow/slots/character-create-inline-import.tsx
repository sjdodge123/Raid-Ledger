import { useState, useEffect, useId } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';
import { isArmoryImportSupported, ARMORY_CLASSIC_VARIANTS, defaultArmoryClassicVariant } from '../lib/armory-import';
import { ArmoryUnavailableNote, ARMORY_TAB_CLS, ARMORY_TAB_TRACK_CLS } from '../components/armory-unavailable-note';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';

interface CharacterCreateInlineImportProps {
    onSuccess?: (character?: import('@raid-ledger/contract').CharacterDto) => void;
    isMain?: boolean;
    gameSlug?: string;
    onModeChange?: (mode: 'import' | 'manual') => void;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
}

/** ROK-1636: `noteId` set = Armory unavailable for this variant — tab is aria-disabled and described by the note. */
function InlineModeToggle({ mode, onModeChange, noteId }: {
    mode: 'manual' | 'import'; onModeChange: (m: 'manual' | 'import') => void; noteId?: string;
}) {
    return (
        <div role="group" aria-label="Add character by" className={ARMORY_TAB_TRACK_CLS}>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={mode === 'import'}
                onClick={() => { if (!noteId) onModeChange('import'); }} aria-disabled={noteId ? true : undefined} aria-describedby={noteId}>
                Import from Armory
            </Button>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={mode === 'manual'}
                onClick={() => onModeChange('manual')}>
                Manual
            </Button>
        </div>
    );
}

function InlineClassicSelector({ classicVariant, onVariantChange }: { classicVariant: string; onVariantChange: (v: string) => void }) {
    return (
        <Field label="Game version" hideLabel>
            <Select value={classicVariant} onChange={(e) => onVariantChange(e.target.value)}>
                {ARMORY_CLASSIC_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
        </Field>
    );
}

/**
 * Inline import slot: renders mode toggle + WowArmoryImportForm
 * inside the InlineCharacterForm context (signup confirmation modal etc).
 */
export function CharacterCreateInlineImport({
    onSuccess, isMain, gameSlug, onModeChange, eventId,
}: CharacterCreateInlineImportProps) {
    const [userMode, setMode] = useState<'manual' | 'import'>('import');
    const isClassic = !!gameSlug && gameSlug !== 'world-of-warcraft' && isWowSlug(gameSlug);
    const fixedVariant = (gameSlug && FIXED_CLASSIC_VARIANTS[gameSlug]) ?? null;
    const showSelector = isClassic && !fixedVariant;
    const { data: variantContext } = useEventVariantContext(eventId, showSelector && !!eventId);
    const [userVariant, setUserVariant] = useState<string | null>(null);
    const classicVariant = fixedVariant ?? userVariant ?? defaultArmoryClassicVariant(variantContext?.gameVariant);
    const gameVariant = isClassic ? classicVariant : 'retail';
    const armoryOk = isArmoryImportSupported(gameVariant);
    const mode = armoryOk ? userMode : 'manual';
    const noteId = useId();

    useEffect(() => { if (gameSlug && isWowSlug(gameSlug)) onModeChange?.(armoryOk ? 'import' : 'manual'); }, [gameSlug, onModeChange, armoryOk]);
    if (!gameSlug || !isWowSlug(gameSlug)) return null;

    const handleModeChange = (m: 'manual' | 'import') => { setMode(m); onModeChange?.(m); };

    return (
        <>
            <InlineModeToggle mode={mode} onModeChange={handleModeChange} noteId={armoryOk ? undefined : noteId} />
            {!armoryOk && <ArmoryUnavailableNote id={noteId} />}
            {mode === 'import' && showSelector && <InlineClassicSelector classicVariant={classicVariant} onVariantChange={setUserVariant} />}
            {mode === 'import' && (
                <WowArmoryImportForm isMain={isMain} gameVariant={gameVariant}
                    defaultRegion={variantContext?.region as import('@raid-ledger/contract').WowRegion | undefined}
                    onSuccess={(character) => onSuccess?.(character)} />
            )}
        </>
    );
}
