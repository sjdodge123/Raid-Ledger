import { useState, useEffect, useId } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';
import { isArmoryImportSupported, ARMORY_CLASSIC_VARIANTS } from '../lib/armory-import';
import { ArmoryUnavailableNote, DISABLED_TAB_CLS } from '../components/armory-unavailable-note';

interface CharacterCreateInlineImportProps {
    onSuccess?: (character?: import('@raid-ledger/contract').CharacterDto) => void;
    isMain?: boolean;
    gameSlug?: string;
    onModeChange?: (mode: 'import' | 'manual') => void;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
}

function inlineImportCls(mode: 'manual' | 'import', disabled: boolean): string {
    if (disabled) return DISABLED_TAB_CLS;
    return mode === 'import' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-muted hover:text-secondary';
}

/** ROK-1636: `noteId` set = Armory unavailable for this variant — tab is aria-disabled and described by the note. */
function InlineModeToggle({ mode, onModeChange, noteId }: {
    mode: 'manual' | 'import'; onModeChange: (m: 'manual' | 'import') => void; noteId?: string;
}) {
    return (
        <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
            <button type="button" onClick={() => { if (!noteId) onModeChange('import'); }} aria-disabled={noteId ? true : undefined} aria-describedby={noteId}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${inlineImportCls(mode, !!noteId)}`}>
                Import from Armory
            </button>
            <button type="button" onClick={() => onModeChange('manual')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'manual' ? 'bg-overlay text-foreground' : 'text-muted hover:text-secondary'}`}>
                Manual
            </button>
        </div>
    );
}

function InlineClassicSelector({ classicVariant, onVariantChange }: { classicVariant: string; onVariantChange: (v: string) => void }) {
    return (
        <select value={classicVariant} onChange={(e) => onVariantChange(e.target.value)}
            className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
            {ARMORY_CLASSIC_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
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
    const classicVariant = fixedVariant ?? userVariant ?? variantContext?.gameVariant ?? 'classic_anniversary';
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
