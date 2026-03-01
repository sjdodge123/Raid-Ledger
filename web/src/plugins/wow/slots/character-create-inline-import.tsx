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

const WOW_SLUGS = new Set(['world-of-warcraft', 'world-of-warcraft-classic']);

function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug);
}

const CLASSIC_VARIANTS = [
    { value: 'classic_anniversary', label: 'Classic Anniversary (TBC)' },
    { value: 'classic_era', label: 'Classic Era / SoD' },
    { value: 'classic', label: 'Classic (Cata)' },
] as const;

/**
 * Inline import slot: renders mode toggle + WowArmoryImportForm
 * inside the InlineCharacterForm context (signup confirmation modal etc).
 */
export function CharacterCreateInlineImport({
    onSuccess,
    isMain,
    gameSlug,
    onModeChange,
    eventId,
}: CharacterCreateInlineImportProps) {
    const [mode, setMode] = useState<'manual' | 'import'>('import');
    const isClassic = gameSlug === 'world-of-warcraft-classic';

    // ROK-587: Track only the user's explicit selection; null = no override yet
    const { data: variantContext } = useEventVariantContext(eventId, isClassic && !!eventId);
    const [userVariant, setUserVariant] = useState<string | null>(null);

    // Effective variant: user override > event context > default
    const classicVariant = userVariant ?? variantContext?.gameVariant ?? 'classic_anniversary';

    // Notify parent of initial import mode on mount so it hides the manual form
    useEffect(() => {
        if (gameSlug && isWowSlug(gameSlug)) {
            onModeChange?.('import');
        }
    }, [gameSlug, onModeChange]);

    if (!gameSlug || !isWowSlug(gameSlug)) return null;

    const gameVariant = isClassic ? classicVariant : 'retail';

    return (
        <>
            {/* Mode toggle */}
            <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
                <button
                    type="button"
                    onClick={() => { setMode('import'); onModeChange?.('import'); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        mode === 'import'
                            ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Import from Armory
                </button>
                <button
                    type="button"
                    onClick={() => { setMode('manual'); onModeChange?.('manual'); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        mode === 'manual'
                            ? 'bg-overlay text-foreground'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Manual
                </button>
            </div>

            {/* Classic variant selector — matches the full-page import form options */}
            {mode === 'import' && isClassic && (
                <select
                    value={classicVariant}
                    onChange={(e) => setUserVariant(e.target.value)}
                    className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                    {CLASSIC_VARIANTS.map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                </select>
            )}

            {mode === 'import' && (
                <WowArmoryImportForm
                    isMain={isMain}
                    gameVariant={gameVariant}
                    defaultRegion={variantContext?.region as import('@raid-ledger/contract').WowRegion | undefined}
                    onSuccess={(character) => {
                        onSuccess?.(character);
                    }}
                />
            )}

            {/* When mode === 'manual', render nothing — the parent form handles manual mode */}
        </>
    );
}
