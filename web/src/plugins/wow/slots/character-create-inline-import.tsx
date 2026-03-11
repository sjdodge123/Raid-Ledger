import { useState, useEffect } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useEventVariantContext } from '../../../hooks/use-events';

interface CharacterCreateInlineImportProps {
    onSuccess?: (character?: import('@raid-ledger/contract').CharacterDto) => void;
    isMain?: boolean;
    gameSlug?: string;
    onModeChange?: (mode: 'import' | 'manual') => void;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
}

const WOW_SLUGS = new Set([
    'world-of-warcraft',
    'world-of-warcraft-classic',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition',
    'world-of-warcraft-burning-crusade-classic',
    'world-of-warcraft-wrath-of-the-lich-king',
]);

function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug);
}

/** Classic variant game slugs that have a fixed variant (no selector needed). */
const FIXED_VARIANT_MAP: Record<string, string> = {
    'world-of-warcraft-burning-crusade-classic-anniversary-edition': 'classic_anniversary',
    'world-of-warcraft-burning-crusade-classic': 'classic',
    'world-of-warcraft-wrath-of-the-lich-king': 'classic',
};

const CLASSIC_VARIANTS = [
    { value: 'classic_anniversary', label: 'Classic Anniversary (TBC)' },
    { value: 'classic_era', label: 'Classic Era / SoD' },
    { value: 'classic', label: 'Classic (Cata)' },
] as const;

function InlineModeToggle({ mode, onModeChange }: {
    mode: 'manual' | 'import'; onModeChange: (m: 'manual' | 'import') => void;
}) {
    return (
        <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
            <button type="button" onClick={() => onModeChange('import')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'import' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-muted hover:text-secondary'}`}>
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
            {CLASSIC_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
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
    const [mode, setMode] = useState<'manual' | 'import'>('import');
    const isClassic = !!gameSlug && gameSlug !== 'world-of-warcraft' && isWowSlug(gameSlug);
    const fixedVariant = (gameSlug && FIXED_VARIANT_MAP[gameSlug]) ?? null;
    const showSelector = isClassic && !fixedVariant;
    const { data: variantContext } = useEventVariantContext(eventId, showSelector && !!eventId);
    const [userVariant, setUserVariant] = useState<string | null>(null);
    const classicVariant = fixedVariant ?? userVariant ?? variantContext?.gameVariant ?? 'classic_anniversary';

    useEffect(() => { if (gameSlug && isWowSlug(gameSlug)) onModeChange?.('import'); }, [gameSlug, onModeChange]);
    if (!gameSlug || !isWowSlug(gameSlug)) return null;

    const gameVariant = isClassic ? classicVariant : 'retail';
    const handleModeChange = (m: 'manual' | 'import') => { setMode(m); onModeChange?.(m); };

    return (
        <>
            <InlineModeToggle mode={mode} onModeChange={handleModeChange} />
            {mode === 'import' && showSelector && <InlineClassicSelector classicVariant={classicVariant} onVariantChange={setUserVariant} />}
            {mode === 'import' && (
                <WowArmoryImportForm isMain={isMain} gameVariant={gameVariant}
                    defaultRegion={variantContext?.region as import('@raid-ledger/contract').WowRegion | undefined}
                    onSuccess={(character) => onSuccess?.(character)} />
            )}
        </>
    );
}
