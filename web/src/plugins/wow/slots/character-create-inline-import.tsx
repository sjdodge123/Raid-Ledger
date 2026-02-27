import { useState } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';

interface CharacterCreateInlineImportProps {
    onSuccess?: (character?: import('@raid-ledger/contract').CharacterDto) => void;
    isMain?: boolean;
    gameSlug?: string;
    onModeChange?: (mode: 'import' | 'manual') => void;
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
}: CharacterCreateInlineImportProps) {
    const [mode, setMode] = useState<'manual' | 'import'>('import');
    const isClassic = gameSlug === 'world-of-warcraft-classic';
    const [classicVariant, setClassicVariant] = useState('classic_anniversary');

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
                    onChange={(e) => setClassicVariant(e.target.value)}
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
                    onSuccess={(character) => {
                        onSuccess?.(character);
                    }}
                />
            )}

            {/* When mode === 'manual', render nothing — the parent form handles manual mode */}
        </>
    );
}
